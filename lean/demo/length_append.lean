theorem target : ∀ (l m : List Nat), (l ++ m).length = l.length + m.length := by
  intro l m
  exact List.length_append
#print axioms target
