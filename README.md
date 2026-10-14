# Context Figma MCP

A **read-only MCP server** for extracting actual Figma prototype flows and transitions. Designed to complement [GLips/Figma-Context-MCP](https://github.com/GLips/Figma-Context-MCP): GLips provides design/layout context, while this server exposes navigational behavior for agent-generated specifications.

**No LLM inference and no Figma writes.** Missing destinations and ambiguous prototype data are returned as explicit warnings. This server does not infer backend business rules from visual design.

## Requirements

- macOS, Linux, or Windows; **Node.js 22+**
- Figma personal access token with `file_content:read`, and permission to view the file
- OpenCode (optional; the MCP Inspector can test tools independently)

## Setup

```bash
 git clone https://github.com/grm/context-figma-mcp.git
 cd context-figma-mcp
 npm install
 npm run build
 npm test
```

Keep the Figma token in your shell/session (not inside Git):

```bash
read -rs 'FIGMA_TOKEN?Figma token: ' FIGMA_TOKEN; echo
export FIGMA_TOKEN
```

On macOS Terminal, if using zsh, `read -rs` can prompt as shown. Or configure the token securely through your shell's credential manager. The token is never written to files by the MCP.

### OpenCode integration

Add the following to the OpenCode configuration that already contains GLips, changing the absolute executable path:

```json
{
  "mcp": {
    "figma-prototype": {
      "type": "local",
      "command": ["node", "/ABSOLUTE/PATH/context-figma-mcp/dist/index.js"],
      "enabled": true,
      "environment": { "FIGMA_TOKEN": "{env:FIGMA_TOKEN}" }
    }
  }
}
```

**Merge this entry into your existing `mcp` object:** do not replace your GLips configuration. Run `opencode mcp list` to verify registration. Restart OpenCode after editing its configuration. See [`examples/opencode.jsonc`](examples/opencode.jsonc).

### Test tools without an LLM

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Click **Connect**, select a tool and supply a Figma file URL or file key. The MCP Inspector launches the server and calls the tool directly.

Then in OpenCode try:

```text
Call figma-prototype_get_prototype_flows on this Figma design URL: https://www.figma.com/design/<FILE_KEY>/... . Report the raw flows, do not invent any transitions.
```

After choosing a flow, use `get_prototype_graph` and optionally `startNodeId` to get just the reachable screens. Use `get_screen_interactions` for buttons/interactions on a particular screen.

## Tools

| Tool | Inputs | Output |
|---|---|---|
| `get_prototype_flows` | `fileKey` | Named Figma flow starts and associated pages |
| `get_prototype_graph` | `fileKey`, optional `startNodeId` | Screens, interactions, explicit destinations and warnings |
| `get_screen_interactions` | `fileKey`, `screenNodeId` | Trigger/actions nested inside one screen |

`fileKey` accepts a file key or `https://www.figma.com/design/...` link. IDs can be `12:345` or `12-345`.

### What the graph preserves

- The triggering event (`ON_CLICK`, `ON_HOVER`, `AFTER_TIMEOUT`, etc.)
- Figma `NODE` actions, with `navigation.type` such as `NAVIGATE`, `OVERLAY`, `SWAP`, `SCROLL_TO`, `CHANGE_TO`
- Non-navigational `BACK`, `CLOSE`, variable and media actions
- Nested `CONDITIONAL` actions, including the original condition object encoded in `conditionPath`
- `transition` animation metadata, including type/duration when present
- Older `transitionNodeID` information only when modern `interactions` are absent
- Exact source and destination IDs, their screen mapping, and `provenance`

A transition to an unknown ID is **not guessed**: `resolved:false` and a warning are returned. `BACK` has no statically known destination, so `destinationId:null`.

### Local test suite

`npm test` exercises a fixture with linked screens, nested interaction nodes, condition branches, an overlay, back/close, unresolved and legacy transitions. No Figma token is needed for the tests. `npm run check` performs TypeScript checking.

## Limitations / roadmap

- This version loads the complete file once **per tool call**. Very large files may be slow or rate-limited; the next iteration can add caching and partial node fetching.
- Figma URLs and destination references stay inside the same file; external navigation uses action metadata, not cross-file screen resolution.
- The server cannot derive functional validation or API behavior from Figma alone. Combine its output with Jira tickets, screenshots and PO validation in `/specify`.
- Frames without configured interactions cannot become reliably inferred navigation flows.
- Only the specific official Figma REST structures are interpreted. Unknown action fields are not treated as implicit transitions.

## Security

Read-only REST endpoint `GET /v1/files/{key}`; file keys are validated; arbitrary URLs are never fetched; token passed only via `X-Figma-Token`; no HTTP server is exposed (stdio only). Never commit `.env` or token values.

## Development

The MCP SDK used is the current v2 TypeScript SDK. Node 22+ required; CI runs types, build and tests for PRs. This implementation is initially tested against synthetic fixtures; validation against a real prototyped Figma file is required before relying on it in a specification pipeline.
