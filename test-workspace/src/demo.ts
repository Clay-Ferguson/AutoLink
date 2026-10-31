// Ctrl/Cmd+click each reference below.

// Works: path relative to the workspace root, with an anchor.
// See: (docs/user_guide/USER_GUIDE.md#tab-bar)

// Works: no anchor, opens at the top.
// See (docs/user_guide/USER_GUIDE.md)

// Works: the target of a markdown link.
// See [the tab bar](docs/user_guide/USER_GUIDE.md#tab-bar).

// Works: angle brackets allow spaces in the path; the title is ignored.
// [HUMAN](<docs/Job Interview Thread/HUMAN.md#follow-up> "id:0854E3AF3")

// Works: a title without angle brackets.
// [GUIDE](docs/user_guide/USER_GUIDE.md "id:0854E3AF3")

// Works: punctuation in the heading is dropped from the anchor.
// (docs/user_guide/USER_GUIDE.md#keyboard-shortcuts--tips)

/**
 * JSDoc works too: (docs/user_guide/USER_GUIDE.md#getting-started)
 */
export const greeting = 'Strings too: (docs/user_guide/USER_GUIDE.md#tab-bar)';

// Warning (yellow squiggle): the heading doesn't exist.
// (docs/user_guide/USER_GUIDE.md#no-such-heading)

// Warning: the file doesn't exist.
// (docs/user_guide/MISSING.md)

// Works: a bare file name opens the only USER_GUIDE.md in the project.
// See: (USER_GUIDE.md#tab-bar)

// Warning: two files are named NOTES.md (docs/team_a and docs/team_b).
// (NOTES.md)

// Not a link: no parentheses.
// docs/user_guide/USER_GUIDE.md#tab-bar

// Not a link: URLs are left to VS Code.
// https://example.com/docs/user_guide/USER_GUIDE.md#tab-bar
