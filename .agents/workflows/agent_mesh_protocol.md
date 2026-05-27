# Agent Mesh Protocol (AMP) — Coordination Standard
This standard outlines a file-based, asynchronous communication mesh designed for multiple AI agents co-authoring the **Sacred Adventures** repository. It leverages a local, git-ignored directory (`.agents/tmp/`) as a robust message bus and context-passing register.

---

## 1. Directory Structure
The coordination mesh operates out of the following hierarchy at the repository root:

```text
.agents/
└── tmp/                  <-- [GIT-IGNORED] Shared Agent Mailbox & Bus
    ├── handshake/        <-- Active Agent heartbeats, states, and capabilities
    └── inbox/            <-- JSON request and response envelopes
```

---

## 2. Protocol Schemas

### A. Handshake Heartbeat (`.agents/tmp/handshake/agent_<name>.json`)
Every agent session must declare its presence upon boot by writing or updating its handshake file.

```json
{
  "agentName": "Antigravity",
  "status": "active",
  "pid": 48120,
  "startedAt": "2026-05-27T07:10:00-05:00",
  "lastActiveAt": "2026-05-27T07:15:30-05:00",
  "git": {
    "head": "e0767a2",
    "branch": "dev/ideasoftware-studio",
    "dirty": false
  },
  "capabilities": [
    "reorganization",
    "performance-benchmarking",
    "playwright-testing",
    "cache-versioning"
  ],
  "currentGoal": "Batch 3 active components relocation & verification pass"
}
```

### B. Request/Response Envelope (`.agents/tmp/inbox/req_<timestamp>_<from>_to_<to>.json`)
To request assistance, an agent writes a structured JSON envelope to the inbox directory.

```json
{
  "id": "amp-task-7df9a2c",
  "timestamp": "2026-05-27T07:12:00-05:00",
  "from": "Antigravity",
  "to": "ResearchSubagent",
  "topic": "Verify Draco glb indices matching key conventions",
  "status": "pending",
  "priority": "high",
  "payload": {
    "targetFiles": [
      "Assets/Avatar3.glb",
      "Assets/animated.deer/source/[deer+3d+model].glb"
    ],
    "context": "Need to ensure all mesh parts in simplified GLBs retain accurate semantic indexing rules under the revised World.js player yaw coordinate changes.",
    "callbackFile": ".agents/tmp/inbox/req_20260527_Antigravity_to_ResearchSubagent.json"
  },
  "response": {
    "processedBy": null,
    "completedAt": null,
    "success": false,
    "data": null,
    "error": null
  }
}
```

---

## 3. Operational Rules for Agents

1. **Boot Handshake**: On startup, scan `.agents/tmp/handshake/` to understand other active agents, then immediately write your own `agent_<name>.json` heartbeat.
2. **Mailbox Sweep**: Periodically or at the start of a turn, scan `.agents/tmp/inbox/` for envelopes where `"to"` is `"broadcast"` or matches your `"agentName"`, and `"status"` is `"pending"`.
3. **Lock & Claim**: Before processing a task, update its `"status"` to `"in_progress"` and set `"response.processedBy"` to your agent name to prevent race conditions.
4. **Fulfill & Reply**: Once the task is executed, update the JSON envelope:
   - Change `"status"` to `"completed"` (or `"failed"`).
   - Set `"response.completedAt"` and `"response.success"`.
   - Populate `"response.data"` with your results.
5. **Teardown**: On session close, clean up your handshake file or set your `"status"` to `"offline"`.

---

## 4. Bootstrapping Prompt Template
Feed the prompt below to any newly initialized AI coder joining this workspace to immediately bring them into sync with the active agent mesh.

```markdown
# AGENT INITIATION DIRECTIVE: JOIN THE AGENT MESH
You are co-authoring the Sacred Adventures repository alongside other AI agents. To coordinate work asynchronously, prevent overlap, share state, and request/provide specialized assistance, you MUST follow the **Agent Mesh Protocol (AMP)**:

1. **Locate the Mailbox**: All communications live in the local, git-ignored directory `.agents/tmp/`.
2. **Register Your Session**: On boot, write a JSON heartbeat describing your name, current capabilities, and active goal to `.agents/tmp/handshake/agent_<YourName>.json`.
3. **Scan for Tasks**: Read `.agents/tmp/inbox/` to check for any pending assistance requests (`"status": "pending"`) routed to you or `"broadcast"`.
4. **Delegate Tasks**: If you need research, optimization, or file operations that are outside your immediate scope or require background work, write a request envelope inside `.agents/tmp/inbox/` using the schema defined in `.agents/workflows/agent_mesh_protocol.md`.
5. **Report Status**: Maintain your heartbeat's `"lastActiveAt"` timestamp and clean up your handshake status when you exit.

Read the full protocol specification at [agent_mesh_protocol.md](file:///.agents/workflows/agent_mesh_protocol.md) before executing your first file operation.
```
