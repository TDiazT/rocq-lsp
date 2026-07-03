(* Fixture: proof/interpret manual navigation tests *)
Lemma add_zero (n : nat) : n + 0 = n.
Proof.
  induction n.
  - reflexivity.
  - simpl. rewrite IHn. reflexivity.
Qed.

Lemma broken : forall n : nat, n = n + 1.
Proof.
  intros n.
  reflexivity.
Abort.
