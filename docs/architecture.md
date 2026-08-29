# Architecture

Ham.Live is a Node.js web application with a reactive client-side framework, providing real-time amateur radio net management through Server-Sent Events and REST APIs.

**See [HL-main.svg](HL-main.svg) for a visual diagram** summarizing the core runtime flows and component relationships.

**See [integration-architecture.svg](integration-architecture.svg) for a detailed view of the system integration patterns and data flow.**

> **Source note:** The codebase is mid JS→TypeScript migration. `server/dist/` is the authoritative running source. Most server files are hand-written JavaScript; a small set (`responseUtils`, `realtimeClients`, `secureSign`, and shared types) are compiled from `server/src/*.ts`. When reading or modifying server code, always work from `server/dist`.

## System Overview

**High-level Architecture:**

- **Server**: Express.js with EJS templates, mounting `/views/*`, `/api/*`, `/api/sse/*`, and `/auth/*` routes
- **Client**: Per-view ES modules (`/js/byView/<view>/main.js`) that instantiate reactive stores and widgets
- **Data Flow**: Stores use polling or SSE to receive `LiveNetDetails`; widgets subscribe to stores and call `EndPointClient` for user actions
- **Real-time**: Server-Sent Events with polling fallback for live updates

## Documentation Navigation

### 🚀 Quick Start Paths

**New to Ham.Live?**
→ [Overview](overview.md) — Product overview and getting started

**Setting up development?**  
→ [Developer Setup](developer-setup.md) — Local environment setup

**Need specific API info?**
→ [API Reference](api-reference.md) — Complete endpoint reference

### 🏗️ Server-side Architecture

**Core Infrastructure:**

- [Server Architecture](server-architecture.md) — Express.js application structure and middleware stack
- [Runtime Configuration](runtime-config.md) — Configuration system (YAML + FlexOptions)
- [Database Models](database-models.md) — MongoDB schemas and data relationships
- [Authentication](authentication.md) — OAuth integration and session management

**Request Processing:**

- [Routing and API](routing-api.md) — API organization and patterns
- [Middleware](middleware.md) — Request processing pipeline and security layers
- [Controllers](controllers.md) — Route handlers and business logic

**Background Systems:**

- [Background Jobs](background-jobs.md) — Scheduled tasks, CLI tools, and asynchronous processing
- [SSE Architecture](sse-architecture.md) — Real-time communication implementation

### 🎨 Client-side Architecture

**Frontend Framework:**

- [Client Framework](client-framework.md) — Reactive stores, widgets, and UI patterns

### 🧠 Data and Domain Logic

**Business Logic:**

- [Shared Net Operations](shared-net-ops.md) — Core domain logic and business rules
- [Data Model](data-model.md) — Quick reference to database entities

### 🔒 Security and Operations

**Security:**

- [Security](security.md) — Security policies and implementation details

**Operations:**

- [Runbook](runbook.md) — Operational procedures and monitoring

### 📚 Reference Materials

**Developer References:**

- [Types](types.md) — TypeScript type system and validation
- [FlexOptions](flex-opts.md) — Runtime configuration options
- [Views](views.md) — User interface and page descriptions

**API Documentation:**

- [API Reference](api-reference.md) — Complete endpoint documentation

## Component Relationships

**Request Flow:**

```
Browser → EJS View → ES Modules → Reactive Stores → EndPointClient → Express Routes → Controllers → SharedNetOps → Database
```

**Real-time Flow:**

```
Database Changes → SharedNetOps → SSE Manager → Client Stores → Reactive Widgets → UI Updates
```

**Configuration Flow:**

```
Environment Variables → YAML Config → FlexOptions (MongoDB) → Middleware → Request Context
```

See also

- [Overview](overview.md) — Product overview and user perspective
- [Developer Setup](developer-setup.md) — Getting started with development
- [Documentation Index](../README.md) — Complete documentation hub
