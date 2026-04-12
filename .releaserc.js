module.exports = {
  branches: ["main"],
  plugins: [
    [
      "@semantic-release/commit-analyzer",
      {
        preset: "conventionalcommits",
        releaseRules: [
          { type: "feat",     release: "minor" },
          { type: "fix",      release: "patch" },
          { type: "publish",  release: "patch" },
          { type: "release",  release: "patch" },
          { type: "build",    release: false   },
          { type: "chore",    release: "patch" },
          { type: "merge",    release: "patch" },
          { type: "refactor", release: "patch" },
          { type: "research", release: "patch" },
          { type: "style",    release: "patch" },
          { type: "test",     release: false   },
          { type: "docs",     release: "patch" },
        ],
      },
    ],
    [
      "@semantic-release/release-notes-generator",
      {
        preset: "conventionalcommits",
        presetConfig: {
          types: [
            { type: "feat",     section: "Features"          },
            { type: "fix",      section: "Bug Fixes"         },
            { type: "publish",  section: "Publishing"        },
            { type: "release",  section: "Releases"          },
            { type: "build",    section: "Build System"      },
            { type: "chore",    section: "Chores"            },
            { type: "merge",    section: "Merges"            },
            { type: "refactor", section: "Code Refactoring"  },
            { type: "research", section: "Research"          },
            { type: "style",    section: "Styles"            },
            { type: "test",     section: "Tests"             },
            { type: "docs",     section: "Documentation"     },
          ],
        },
      },
    ],
    "@semantic-release/changelog",
    "@semantic-release/github",
  ],
};
