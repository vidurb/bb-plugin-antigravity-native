// Match the built-in command selection BB sends for its compact action.
export const compactInput = [
  {
    type: "text" as const,
    text: "/compact",
    mentions: [
      {
        start: 0,
        end: 8,
        resource: {
          kind: "command" as const,
          trigger: "/" as const,
          name: "compact",
          source: "command" as const,
          origin: "builtin" as const,
          label: "compact",
          argumentHint: null,
        },
      },
    ],
  },
];
