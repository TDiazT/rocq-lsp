(* Fixture: go-to-definition tests *)
Definition answer : nat := 42.

Definition double (n : nat) : nat := n + n.

Definition result : nat := double answer.
