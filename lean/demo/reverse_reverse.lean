theorem target : ∀ (l : List Nat), List.reverse (List.reverse l) = l := by
  intro l
  exact List.reverse_reverse l
#print axioms target
