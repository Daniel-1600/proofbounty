//! ProofBounty escrow program.
//!
//! Skeleton: accounts, PDA seeds, instruction signatures, events and errors
//! follow SPEC.md exactly. Handler logic lands in Milestone 1.

use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BmZ7FEfcYkg476zPFsLnS");

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
        _ctx: Context<CreateBounty>,
        _bounty_id: u64,
        _theorem_hash: [u8; 32],
        _statement_uri: String,
        _reward: u64,
        _deadline: i64,
        _verifiers: [Pubkey; 3],
    ) -> Result<()> {
        err!(ProofBountyError::NotImplemented)
    }

    pub fn submit_proof(
        _ctx: Context<SubmitProof>,
        _proof_hash: [u8; 32],
        _proof_uri: String,
    ) -> Result<()> {
        err!(ProofBountyError::NotImplemented)
    }

    pub fn vote(_ctx: Context<Vote>, _approve: bool) -> Result<()> {
        err!(ProofBountyError::NotImplemented)
    }

    pub fn refund(_ctx: Context<Refund>) -> Result<()> {
        err!(ProofBountyError::NotImplemented)
    }
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
    #[msg("Not implemented yet")]
    NotImplemented,
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
