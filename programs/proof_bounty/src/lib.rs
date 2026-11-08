//! ProofBounty escrow program.
//!
//! Accounts, PDA seeds and instructions follow SPEC.md exactly.

use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("28CYsLKihZfAQWz513EAEXS52hc9npL9frZw1VpPAz3i");

pub const BOUNTY_SEED: &[u8] = b"bounty";
pub const SUBMISSION_SEED: &[u8] = b"sub";
pub const MAX_STATEMENT_URI_LEN: usize = 200;
/// SPEC.md does not cap `proof_uri`; use the same limit as `statement_uri`.
pub const MAX_PROOF_URI_LEN: usize = 200;
pub const NUM_VERIFIERS: usize = 3;
pub const VOTE_THRESHOLD: u32 = 2;

#[program]
pub mod proof_bounty {
    use super::*;

    pub fn create_bounty(
        ctx: Context<CreateBounty>,
        bounty_id: u64,
        theorem_hash: [u8; 32],
        statement_uri: String,
        reward: u64,
        deadline: i64,
        verifiers: [Pubkey; 3],
    ) -> Result<()> {
        require!(
            statement_uri.len() <= MAX_STATEMENT_URI_LEN,
            ProofBountyError::StatementUriTooLong
        );
        require!(reward > 0, ProofBountyError::ZeroReward);
        let now = Clock::get()?.unix_timestamp;
        require!(deadline > now, ProofBountyError::DeadlineInPast);
        require!(
            verifiers[0] != verifiers[1]
                && verifiers[0] != verifiers[2]
                && verifiers[1] != verifiers[2],
            ProofBountyError::DuplicateVerifier
        );

        let bounty = &mut ctx.accounts.bounty;
        bounty.creator = ctx.accounts.creator.key();
        bounty.bounty_id = bounty_id;
        bounty.theorem_hash = theorem_hash;
        bounty.statement_uri = statement_uri.clone();
        bounty.reward = reward;
        bounty.deadline = deadline;
        bounty.verifiers = verifiers;
        bounty.status = BountyStatus::Open;
        bounty.winner = None;
        bounty.bump = ctx.bumps.bounty;

        // Escrow the reward on top of the PDA's rent-exempt minimum.
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: ctx.accounts.bounty.to_account_info(),
                },
            ),
            reward,
        )?;

        emit!(BountyCreated {
            bounty: ctx.accounts.bounty.key(),
            creator: ctx.accounts.creator.key(),
            bounty_id,
            theorem_hash,
            statement_uri,
            reward,
            deadline,
            verifiers,
        });
        Ok(())
    }

    pub fn submit_proof(
        ctx: Context<SubmitProof>,
        proof_hash: [u8; 32],
        proof_uri: String,
    ) -> Result<()> {
        require!(
            proof_uri.len() <= MAX_PROOF_URI_LEN,
            ProofBountyError::ProofUriTooLong
        );
        let bounty = &ctx.accounts.bounty;
        require!(
            bounty.status == BountyStatus::Open,
            ProofBountyError::BountyNotOpen
        );
        let now = Clock::get()?.unix_timestamp;
        require!(now <= bounty.deadline, ProofBountyError::DeadlinePassed);

        let submission = &mut ctx.accounts.submission;
        submission.bounty = bounty.key();
        submission.solver = ctx.accounts.solver.key();
        submission.proof_hash = proof_hash;
        submission.proof_uri = proof_uri.clone();
        submission.approvals = 0;
        submission.rejections = 0;
        submission.status = SubmissionStatus::Pending;
        submission.bump = ctx.bumps.submission;

        emit!(ProofSubmitted {
            bounty: bounty.key(),
            submission: submission.key(),
            solver: submission.solver,
            proof_hash,
            proof_uri,
        });
        Ok(())
    }

    pub fn vote(ctx: Context<Vote>, approve: bool) -> Result<()> {
        let verifier = ctx.accounts.verifier.key();
        let bounty_key = ctx.accounts.bounty.key();
        let submission_key = ctx.accounts.submission.key();

        require!(
            ctx.accounts.bounty.status == BountyStatus::Open,
            ProofBountyError::BountyNotOpen
        );
        require!(
            ctx.accounts.submission.status == SubmissionStatus::Pending,
            ProofBountyError::SubmissionNotPending
        );
        let index = ctx
            .accounts
            .bounty
            .verifiers
            .iter()
            .position(|v| *v == verifier)
            .ok_or(ProofBountyError::NotVerifier)?;
        let bit = 1u8 << index;

        let submission = &mut ctx.accounts.submission;
        require!(
            (submission.approvals | submission.rejections) & bit == 0,
            ProofBountyError::AlreadyVoted
        );
        if approve {
            submission.approvals |= bit;
        } else {
            submission.rejections |= bit;
        }
        let (approvals, rejections, solver) =
            (submission.approvals, submission.rejections, submission.solver);

        emit!(VoteCast {
            bounty: bounty_key,
            submission: submission_key,
            verifier,
            verifier_index: index as u8,
            approve,
            approvals,
            rejections,
        });

        if approvals.count_ones() >= VOTE_THRESHOLD {
            ctx.accounts.submission.status = SubmissionStatus::Accepted;
            let bounty = &mut ctx.accounts.bounty;
            bounty.status = BountyStatus::Solved;
            bounty.winner = Some(solver);
            let reward = bounty.reward;
            pay_out(
                &ctx.accounts.bounty.to_account_info(),
                &ctx.accounts.solver.to_account_info(),
                reward,
            )?;
            emit!(SubmissionAccepted {
                bounty: bounty_key,
                submission: submission_key,
                solver,
                reward,
            });
        } else if rejections.count_ones() >= VOTE_THRESHOLD {
            ctx.accounts.submission.status = SubmissionStatus::Rejected;
            emit!(SubmissionRejected {
                bounty: bounty_key,
                submission: submission_key,
                solver,
            });
        }
        Ok(())
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        let bounty = &mut ctx.accounts.bounty;
        require!(
            bounty.status == BountyStatus::Open,
            ProofBountyError::BountyNotOpen
        );
        let now = Clock::get()?.unix_timestamp;
        require!(now > bounty.deadline, ProofBountyError::DeadlineNotReached);
        bounty.status = BountyStatus::Refunded;
        let reward = bounty.reward;
        pay_out(
            &ctx.accounts.bounty.to_account_info(),
            &ctx.accounts.creator.to_account_info(),
            reward,
        )?;
        emit!(BountyRefunded {
            bounty: ctx.accounts.bounty.key(),
            creator: ctx.accounts.creator.key(),
            reward,
        });
        Ok(())
    }
}

/// Moves `amount` lamports out of the program-owned bounty PDA, refusing to
/// dip below its rent-exempt minimum.
fn pay_out<'info>(
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    let min = Rent::get()?.minimum_balance(from.data_len());
    let remaining = from
        .lamports()
        .checked_sub(amount)
        .ok_or(ProofBountyError::Overflow)?;
    require!(remaining >= min, ProofBountyError::Overflow);
    from.sub_lamports(amount)?;
    to.add_lamports(amount)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/// PDA seeds: `[b"bounty", creator, bounty_id.to_le_bytes()]`.
/// Holds the reward in lamports on top of its rent-exempt minimum.
#[account]
#[derive(InitSpace)]
pub struct Bounty {
    pub creator: Pubkey,
    pub bounty_id: u64,
    /// sha256 of the exact statement text.
    pub theorem_hash: [u8; 32],
    #[max_len(MAX_STATEMENT_URI_LEN)]
    pub statement_uri: String,
    pub reward: u64,
    pub deadline: i64,
    pub verifiers: [Pubkey; 3],
    pub status: BountyStatus,
    pub winner: Option<Pubkey>,
    pub bump: u8,
}

/// PDA seeds: `[b"sub", bounty, solver]`.
#[account]
#[derive(InitSpace)]
pub struct Submission {
    pub bounty: Pubkey,
    pub solver: Pubkey,
    pub proof_hash: [u8; 32],
    #[max_len(MAX_PROOF_URI_LEN)]
    pub proof_uri: String,
    /// Bitmask: bit i set when verifiers[i] approved.
    pub approvals: u8,
    /// Bitmask: bit i set when verifiers[i] rejected.
    pub rejections: u8,
    pub status: SubmissionStatus,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum BountyStatus {
    Open,
    Solved,
    Refunded,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum SubmissionStatus {
    Pending,
    Accepted,
    Rejected,
}

// ---------------------------------------------------------------------------
// Instruction contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(bounty_id: u64)]
pub struct CreateBounty<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = 8 + Bounty::INIT_SPACE,
        seeds = [BOUNTY_SEED, creator.key().as_ref(), &bounty_id.to_le_bytes()],
        bump,
    )]
    pub bounty: Account<'info, Bounty>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitProof<'info> {
    #[account(mut)]
    pub solver: Signer<'info>,
    #[account(
        seeds = [BOUNTY_SEED, bounty.creator.as_ref(), &bounty.bounty_id.to_le_bytes()],
        bump = bounty.bump,
    )]
    pub bounty: Account<'info, Bounty>,
    #[account(
        init,
        payer = solver,
        space = 8 + Submission::INIT_SPACE,
        seeds = [SUBMISSION_SEED, bounty.key().as_ref(), solver.key().as_ref()],
        bump,
    )]
    pub submission: Account<'info, Submission>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Vote<'info> {
    pub verifier: Signer<'info>,
    #[account(
        mut,
        seeds = [BOUNTY_SEED, bounty.creator.as_ref(), &bounty.bounty_id.to_le_bytes()],
        bump = bounty.bump,
    )]
    pub bounty: Account<'info, Bounty>,
    #[account(
        mut,
        seeds = [SUBMISSION_SEED, bounty.key().as_ref(), submission.solver.as_ref()],
        bump = submission.bump,
        has_one = bounty,
    )]
    pub submission: Account<'info, Submission>,
    /// CHECK: receives the reward; pinned to `submission.solver`.
    #[account(mut, address = submission.solver)]
    pub solver: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        mut,
        seeds = [BOUNTY_SEED, creator.key().as_ref(), &bounty.bounty_id.to_le_bytes()],
        bump = bounty.bump,
        has_one = creator,
    )]
    pub bounty: Account<'info, Bounty>,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct BountyCreated {
    pub bounty: Pubkey,
    pub creator: Pubkey,
    pub bounty_id: u64,
    pub theorem_hash: [u8; 32],
    pub statement_uri: String,
    pub reward: u64,
    pub deadline: i64,
    pub verifiers: [Pubkey; 3],
}

#[event]
pub struct ProofSubmitted {
    pub bounty: Pubkey,
    pub submission: Pubkey,
    pub solver: Pubkey,
    pub proof_hash: [u8; 32],
    pub proof_uri: String,
}

#[event]
pub struct VoteCast {
    pub bounty: Pubkey,
    pub submission: Pubkey,
    pub verifier: Pubkey,
    pub verifier_index: u8,
    pub approve: bool,
    pub approvals: u8,
    pub rejections: u8,
}

#[event]
pub struct SubmissionAccepted {
    pub bounty: Pubkey,
    pub submission: Pubkey,
    pub solver: Pubkey,
    pub reward: u64,
}

#[event]
pub struct SubmissionRejected {
    pub bounty: Pubkey,
    pub submission: Pubkey,
    pub solver: Pubkey,
}

#[event]
pub struct BountyRefunded {
    pub bounty: Pubkey,
    pub creator: Pubkey,
    pub reward: u64,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum ProofBountyError {
    #[msg("Statement URI exceeds 200 characters")]
    StatementUriTooLong,
    #[msg("Proof URI exceeds 200 characters")]
    ProofUriTooLong,
    #[msg("Reward must be greater than zero")]
    ZeroReward,
    #[msg("Deadline must be in the future")]
    DeadlineInPast,
    #[msg("Verifiers must be three distinct keys")]
    DuplicateVerifier,
    #[msg("Bounty is not open")]
    BountyNotOpen,
    #[msg("Bounty deadline has passed")]
    DeadlinePassed,
    #[msg("Bounty deadline has not passed yet")]
    DeadlineNotReached,
    #[msg("Signer is not one of the bounty's verifiers")]
    NotVerifier,
    #[msg("Verifier has already voted on this submission")]
    AlreadyVoted,
    #[msg("Submission is not pending")]
    SubmissionNotPending,
    #[msg("Arithmetic overflow")]
    Overflow,
}
