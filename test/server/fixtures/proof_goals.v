(* Fixture: proof/goals tests *)
Lemma add_zero (n : nat) : n + 0 = n.
Proof.
  induction n.
  - reflexivity.
  - simpl. rewrite IHn. reflexivity.
Qed.

Lemma trivial : True.
Proof. exact I. Qed.
