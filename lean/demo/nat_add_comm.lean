theorem target : ∀ a b : Nat, a + b = b + a := by
  intro a b
  exact Nat.add_comm a b
#print axioms target
