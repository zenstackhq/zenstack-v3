1. `auth()` cannot be directly compared with a relation anymore
2. `update` and `delete` policy rejection throws `NotFoundError`
3. non-optional to-one relation doesn't automatically filter parent read when evaluating access policies
