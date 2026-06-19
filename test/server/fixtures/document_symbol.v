(* Fixture: documentSymbol tests *)
Definition foo : nat := 1.

Lemma bar : foo = foo.
Proof. reflexivity. Qed.

Section MySection.
  Definition baz : nat := 2.
End MySection.
