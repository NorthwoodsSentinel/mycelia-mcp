test("isSweepAuthored requires both the automation author and the sweep's labels", () => {
  const owned = {
    author: { login: "github-actions", is_bot: true },
    labels: SWEEP_LABELS.map((name) => ({ name })),
  };
  assert.equal(isSweepAuthored(owned), true);
  // The SAME account has three spellings; all three must be accepted, or
  // suppression silently stops working (#2377). See `AUTOMATION_LOGIN`.
  for (const login of [
    "github-actions", // older `gh issue list --json author`
    "github-actions[bot]", // REST comments endpoint
    "app/github-actions", // newer `gh issue list --json author` — the #2377 miss
    "App/GitHub-Actions[bot]", // nothing promises a casing or one form at a time
  ]) {
    assert.equal(
      isSweepAuthored({ ...owned, author: { login } }),
      true,
      `login spelling ${JSON.stringify(login)} must be recognized as the sweep's own`,
    );
  }
  // The prefix strip must not become a way in for an account that is NOT ours.
  // `/` is not legal in a GitHub username, so these cannot exist — but the
  // predicate should not be the reason we believe that.
  for (const login of [
    "app/someone",
    "notapp/github-actions",
    "app/github-actions-nightly",
    "github-actions-nightly",
    "app//github-actions",
  ]) {
    assert.equal(
      isSweepAuthored({ ...owned, author: { login } }),
      false,
      `login spelling ${JSON.stringify(login)} must NOT be accepted`,
    );
  }
  // An outsider's issue carrying a forged marker: right shape, wrong provenance.
  assert.equal(
    isSweepAuthored({ ...owned, author: { login: "someone", is_bot: false } }),
    false,
  );
  // A human account named to look official is still a human account.
  assert.equal(
    isSweepAuthored({
      ...owned,
      author: { login: "github-actions", is_bot: false },
    }),
    false,
  );
  // Right author, but missing a label only someone with write access can set.
  assert.equal(
    isSweepAuthored({ ...owned, labels: [{ name: "chore" }] }),
    false,
  );
  assert.equal(isSweepAuthored({ ...owned, labels: [] }), false);
  assert.equal(isSweepAuthored({}), false);
});

test("hasSweepAuthor and hasSweepLabels are the two independent halves", () => {
  const owned = {
    author: { login: "app/github-actions", is_bot: true },
    labels: SWEEP_LABELS.map((name) => ({ name })),
  };
  assert.equal(hasSweepAuthor(owned), true);
  assert.equal(hasSweepLabels(owned), true);
  // Each half ignores the other's input entirely.
  assert.equal(hasSweepAuthor({ ...owned, labels: [] }), true);
  assert.equal(
    hasSweepLabels({ ...owned, author: { login: "someone" } }),
    true,
  );
  assert.equal(
    hasSweepLabels({ ...owned, labels: [{ name: "chore" }] }),
    false,
  );
  assert.equal(hasSweepAuthor({}), false);
  assert.equal(hasSweepLabels({}), false);
});
