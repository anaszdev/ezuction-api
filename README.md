> 💡 **Note:** This is the **Backend** repository. To view and search the **Frontend** code, click [here](https://github.com/anaszdev/ezuction-frontend).

# Ezuction Backend

> A real-time online auction backend built around NestJS, PostgreSQL, Redis, Socket.IO, and BullMQ — with wallet reservations, auction lifecycle orchestration, Google OAuth 2.0 authentication, eligibility checks, and location-aware auction data.

Ezuction is designed for a marketplace where the same account can act as both **buyer and seller**. Users can fund their wallet, subscribe to auctions, reserve the required participation amount, join live auctions, place bids in real time, and — when the auction ends — have the winner determined according to the auction's business rules.

This repository contains the **backend only**. The frontend/client application is maintained separately.

---

## Table of Contents

- [Overview](#overview)
- [Core Capabilities](#core-capabilities)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Backend Structure](#backend-structure)
- [Auction Lifecycle](#auction-lifecycle)
- [Wallet & Financial Integrity](#wallet--financial-integrity)
- [Real-Time Auction Flow](#real-time-auction-flow)
- [Redis Responsibilities](#redis-responsibilities)
- [Background Jobs & Scheduling](#background-jobs--scheduling)
- [Authentication & Authorization](#authentication--authorization)
- [Auction Eligibility](#auction-eligibility)
- [Deposit / Wallet Funding Flow](#deposit--wallet-funding-flow)
- [Auction Rules](#auction-rules)
- [Location Support](#location-support)
- [Data Model](#data-model)
- [Concurrency & Consistency](#concurrency--consistency)
- [Configuration](#configuration)
- [Local Development](#local-development)
- [Database & Prisma](#database--prisma)
- [Background Workers](#background-workers)
- [Production Architecture](#production-architecture)
- [Security Considerations](#security-considerations)
- [Operational Considerations](#operational-considerations)
- [Project Status](#project-status)
- [License](#license)

---

## Overview

Ezuction is not implemented as a simple CRUD auction system.

The backend is split conceptually into four cooperating layers:

```text
                    ┌─────────────────────────┐
                    │       Client Apps       │
                    │     Web / Mobile UI     │
                    └────────────┬────────────┘
                                 │
                    HTTP / WebSocket
                                 │
                    ┌────────────▼────────────┐
                    │       NestJS API        │
                    │ Auth / Auctions / Bids  │
                    │ Wallet / Deposits / ACL │
                    └───────┬────────┬────────┘
                            │        │
               ┌────────────┘        └─────────────┐
               │                                   │
       ┌───────▼────────┐                 ┌────────▼────────┐
       │   PostgreSQL   │                 │      Redis      │
       │ Source of truth│                 │ Cache / state / │
       │  & persistence │                 │ realtime support│
       └────────────────┘                 └────────┬────────┘
                                                   │
                                           ┌───────▼────────┐
                                           │     BullMQ      │
                                           │ Background jobs │
                                           │ Auction timers  │
                                           │ & lifecycle     │
                                           └─────────────────┘
```

The main design principle is:

> **PostgreSQL is the persistent source of truth, while Redis and BullMQ provide fast coordination, temporary state, caching, and asynchronous execution.**

This distinction is particularly important for wallet operations and auction settlement.

---

# Core Capabilities

### User accounts

- Google OAuth 2.0 authentication
- Session-based authentication
- Cookie-based session handling
- Session revocation
- Authentication guards and authorization decorators
- Profile completion tracking
- Account activity information
- User roles
- Same account can participate as both buyer and seller

### Auctions

- Create, update, and delete auctions
- Upcoming / live / completed lifecycle
- Scheduled auction start
- Scheduled auction completion
- Fixed and soft-close auctions
- Reserve price
- Starting price
- Current price
- Bid increment
- Minimum participant requirement
- Seller participation deposit
- Buyer participation deposit
- Auction cancellation states
- Winner determination
- Reserve-price validation
- Seller-default and buyer-default states
- Location metadata

### Wallet

- User wallet balance
- Frozen/reserved balance
- Participation deposit reservation
- Seller-side auction deposit reservation
- Deposit requests
- Admin approval workflow
- Financial state validation

### Real-time bidding

- Socket.IO auction rooms/events
- Live bid propagation
- Real-time current price updates
- Participant updates
- Auction state updates
- Server-side eligibility validation
- Fast synchronization through Redis

### Background processing

- BullMQ queues
- Scheduled auction lifecycle jobs
- Delayed jobs
- Auction state transitions
- Completion and settlement processing
- Redis-backed asynchronous execution

### Location

- Latitude / longitude support
- Address metadata
- OpenStreetMap-compatible location workflows

---

# Architecture

The backend follows a modular NestJS architecture.

A simplified representation of the current application structure is:

```text
src/
├── auction/
│   ├── auction.controller.ts
│   ├── auction.gateway.ts
│   ├── auction.module.ts
│   ├── auction.service.ts
│   ├── auction-subscription/
│   └── auction-state/
│
├── auth/
│   ├── auth.controller.ts
│   ├── auth.module.ts
│   ├── auth.service.ts
│   └── strategies/
│
├── bid/
│   ├── bid.module.ts
│   └── bid.service.ts
│
├── database/
│   ├── database.module.ts
│   └── database.service.ts
│
├── redis/
│   ├── redis.module.ts
│   └── redis.service.ts
│
├── upload/
│   └── upload.controller.ts
│
├── user/
│   ├── user.controller.ts
│   ├── user.module.ts
│   └── user.service.ts
│
├── wallet/
│   ├── deposit.controller.ts
│   ├── deposit.module.ts
│   ├── deposit.service.ts
│   └── ...
│
├── app.module.ts
└── main.ts
```

The exact directory layout may evolve as the application grows, but the architectural boundaries should remain clear.

---

# Technology Stack

| Technology | Responsibility |
|---|---|
| **NestJS** | Application framework and modular backend architecture |
| **TypeScript** | Application language |
| **PostgreSQL** | Persistent relational database |
| **Prisma** | ORM and database access layer |
| **Neon** | Managed PostgreSQL infrastructure |
| **Redis** | Caching, temporary state, coordination, and fast lookups |
| **BullMQ** | Background jobs and delayed auction lifecycle processing |
| **Socket.IO** | Real-time auction communication |
| **Google OAuth 2.0** | Authentication |
| **OpenStreetMap** | Location/map support |
| **Cookies** | Session transport |
| **Docker** | Local/deployment containerization where applicable |

---

# Backend Structure

## Auction module

The auction module owns the auction domain.

Responsibilities include:

- Auction creation
- Auction updates
- Auction deletion
- Auction querying
- Auction status transitions
- Auction subscriptions
- Auction lifecycle coordination
- Auction gateway / WebSocket communication
- Seller-specific monitoring
- Participant-specific access rules

The auction domain should remain the authoritative place for auction business rules instead of distributing them across controllers and gateways.

---

## Bid module

The bid module handles:

- Bid validation
- Bid creation
- Bid increment rules
- Bid persistence
- Bid-to-auction association
- Bidder association

A bid must never be accepted solely because a client emitted a WebSocket event.

The server validates:

1. The auction exists.
2. The auction is currently live.
3. The bidder is eligible.
4. The bidder is subscribed.
5. The bidder has the required financial authorization.
6. The bid amount satisfies the auction rules.
7. The auction has not already been closed.
8. The request is consistent with the current auction state.

---

## Wallet module

The wallet domain is responsible for financial state.

The system distinguishes between:

```text
Available Balance
       +
Frozen / Reserved Balance
       =
Total Wallet Funds
```

A participation amount should not simply disappear from the wallet.

Instead, it is reserved/frozen so that the system can later:

- release it,
- apply it to settlement,
- or transfer it according to the final auction outcome.

---

## Deposit module

Deposit requests provide a controlled funding workflow.

A user can submit:

- Amount
- Payment method
- Transaction/reference number
- Optional receipt image

The request starts as:

```text
PENDING
```

An administrator can then:

```text
PENDING
   │
   ├── APPROVED
   │
   └── REJECTED
```

Wallet balance should only be credited after the corresponding request is successfully approved.

---

# Auction Lifecycle

An auction follows a controlled lifecycle.

```text
                     ┌─────────────┐
                     │   UPCOMING  │
                     └──────┬──────┘
                            │ startAt
                            ▼
                     ┌─────────────┐
                     │     LIVE    │
                     └──────┬──────┘
                            │
                ┌───────────┼────────────┐
                │           │            │
                ▼           ▼            ▼
             Success     Reserve      Insufficient
                │         Not Met       Bidders
                ▼           ▼            ▼
     CLOSED_SUCCESSFULLY  RESERVE_     CANCELED_
                         NOT_MET       INSUFFICIENT_BIDDERS
```

Other terminal states may be reached through exceptional conditions:

```text
CANCELED
SELLER_DEFAULTED
BUYER_DEFAULTED
COMPLETED
```

The exact transition must always be validated by the backend.

---

## Upcoming phase

Before `startAt`, the auction is visible as an upcoming auction.

Clients can receive:

- Auction information
- Starting price
- Reserve price where policy permits
- Required deposit
- Seller information
- Location
- Participant count
- Countdown to start
- Current auction status

The client-side countdown is only a presentation mechanism.

**The server remains authoritative about when an auction starts.**

---

## Live phase

When the scheduled start time is reached:

```text
UPCOMING → LIVE
```

The auction becomes eligible for bidding.

Participants connect to the corresponding Socket.IO room and receive live updates.

---

## Completion phase

When the auction reaches its end condition, the backend evaluates:

1. Auction status
2. Number of eligible participants
3. Highest valid bid
4. Reserve price
5. Closure rules
6. Buyer/seller financial state
7. Any applicable default conditions

Only after these checks should the auction be finalized.

---

# Wallet & Financial Integrity

Financial state is one of the most sensitive parts of Ezuction.

The backend should treat wallet operations as **state transitions**, not simple balance assignments.

### Example: reserving a participation deposit

Given:

```text
availableBalance = 1,000,000
depositRequired  =   50,000
```

After reservation:

```text
availableBalance =   950,000
frozenBalance    =    50,000
```

The total funds remain:

```text
950,000 + 50,000 = 1,000,000
```

This allows the platform to guarantee that the participant has committed the required funds without permanently spending them.

---

## Required financial invariant

A wallet operation should preserve:

```text
available balance >= 0
frozen balance >= 0
```

and, conceptually:

```text
total wallet funds = available funds + reserved funds
```

Any operation that breaks these invariants must fail atomically.

---

## Important implementation rule

Wallet mutations should be executed inside a database transaction whenever multiple records must change together.

For example:

```text
BEGIN TRANSACTION

1. Lock/read the user's financial state.
2. Validate available balance.
3. Increase frozen balance.
4. Decrease available balance.
5. Create the reservation/subscription state.
6. Commit.

COMMIT
```

If any step fails:

```text
ROLLBACK
```

Redis must not be treated as the final authority for money.

Redis can accelerate authorization and coordination, but **financial truth belongs to PostgreSQL**.

---

# Real-Time Auction Flow

Socket.IO is used to deliver the live auction experience.

A simplified flow:

```text
Participant
    │
    │ WebSocket
    ▼
Auction Gateway
    │
    ├── Authenticate
    ├── Validate auction
    ├── Validate participant
    ├── Validate bid
    │
    ▼
Auction/Bid Service
    │
    ├── Persist bid
    ├── Update auction state
    └── Publish event
    │
    ▼
Redis / Socket.IO
    │
    ├───────────────┬───────────────┐
    ▼               ▼               ▼
Bidder A         Bidder B        Seller Monitor
```

The server broadcasts relevant events to the auction room instead of forcing every client to continuously poll the API.

---

## Typical real-time events

The exact event names can evolve, but the event model should cover concepts such as:

```text
auction:joined
auction:state
auction:started
auction:bid
auction:participant-count
auction:extended
auction:closing
auction:closed
auction:winner
auction:error
```

The client should treat server events as authoritative.

---

# Redis Responsibilities

Redis is intentionally used for several performance-sensitive concerns.

Typical responsibilities include:

### Session-related lookups

Fast session validation and session-related state.

### User registration / lookup optimization

Frequently accessed information can be cached to avoid unnecessary database reads.

### Auction runtime state

Temporary auction information can be stored or coordinated through Redis where appropriate.

### Real-time coordination

Redis can support fast event propagation and shared state in a horizontally scaled Socket.IO deployment.

### Counters

The homepage and live auction views can use Redis-backed counters for fast access to frequently changing numbers, such as active auction counts or participant counts.

### Distributed coordination

Redis can be used as part of the coordination layer for workers and real-time infrastructure.

---

## Redis is not the financial source of truth

This is a deliberate architectural boundary:

```text
PostgreSQL
    ↓
Permanent financial state

Redis
    ↓
Fast / temporary / derived state
```

If Redis is lost or restarted, the application should be able to reconstruct critical persistent state from PostgreSQL.

---

# Background Jobs & Scheduling

Auction timing is handled asynchronously using **BullMQ** and Redis.

When an auction is created, the backend can schedule lifecycle jobs based on its timestamps.

Conceptually:

```text
Create Auction
      │
      ├── Queue "auction:start"
      │
      ├── Queue "auction:end"
      │
      └── Additional lifecycle jobs
```

At the scheduled time:

```text
BullMQ Worker
      │
      ▼
Load auction
      │
      ▼
Validate current state
      │
      ├── Start auction
      │
      ├── Extend auction
      │
      ├── Close auction
      │
      └── Cancel / finalize
```

The worker must re-check the current database state before performing a transition.

This protects the system from stale or duplicated jobs.

---

## Why jobs instead of only cron?

A generic scheduler can periodically scan the database:

```text
Every N seconds:
    find auctions that should start/end
```

BullMQ allows the system to schedule work closer to the actual event time and provides:

- Delayed jobs
- Retry behavior
- Job persistence
- Worker isolation
- Failure recovery
- Queue monitoring
- Horizontal worker scaling

A scheduler can still be used as a recovery mechanism to detect missed or inconsistent jobs.

---

# Soft Close Auctions

Ezuction supports a soft-close model.

The purpose of soft closing is to prevent a last-second bid from ending the auction immediately.

For example:

```text
Auction end:
18:00:00

Bid arrives:
17:59:20

Buffer:
120 seconds
```

The system can extend the auction according to its configured closure policy.

This behavior must be implemented server-side.

The browser countdown is never responsible for deciding whether the auction is over.

---

# Authentication & Authorization

Authentication is based on Google OAuth 2.0 with server-side session management.

The backend uses concepts such as:

```text
Google OAuth
     │
     ▼
Authentication
     │
     ▼
Session creation
     │
     ▼
Secure cookie
     │
     ▼
Auth Guard
     │
     ▼
Current User
```

---

## Guards and decorators

Authorization should be expressed through reusable NestJS guards/decorators instead of repeating checks inside every controller.

Examples of authorization concepts:

```text
Authenticated user
Admin
Auction owner
Auction participant
Eligible bidder
Active account
```

The same user can be both:

```text
Seller
+
Buyer
```

There is therefore no requirement for separate buyer and seller accounts.

---

# Auction Eligibility

Joining an auction is not equivalent to being allowed to bid.

The backend evaluates eligibility before accepting a bid.

A conceptual eligibility check:

```text
Is authenticated?
        │
        ▼
Is account active?
        │
        ▼
Is auction LIVE?
        │
        ▼
Is user subscribed?
        │
        ▼
Is required deposit available/reserved?
        │
        ▼
Is user allowed to bid?
        │
        ▼
Validate bid amount
        │
        ▼
Accept bid
```

The same rules should be enforced regardless of whether the request originated from:

- REST
- WebSocket
- Internal worker
- Administrative action

---

# Deposit / Wallet Funding Flow

Users can request wallet funding through the deposit workflow.

Example:

```text
User
 │
 │ submit deposit request
 ▼
PENDING
 │
 │ Admin reviews
 ├───────────────┐
 ▼               ▼
APPROVED        REJECTED
 │
 ▼
Wallet credited
```

A receipt can be attached to a deposit request.

The approval operation should be idempotent so that repeated administrator actions cannot credit the same deposit twice.

---

# Auction Rules

The auction model contains the following primary concepts.

| Field | Purpose |
|---|---|
| `startingPrice` | Initial auction price |
| `currentPrice` | Current highest auction price |
| `reservePrice` | Minimum acceptable final price |
| `bidIncrement` | Minimum increment between bids |
| `depositRequired` | Buyer participation amount |
| `sellerDepositFrozen` | Seller-side reserved amount |
| `minParticipants` | Minimum required participant count |
| `closureType` | Fixed or soft close |
| `bufferTime` | Soft-close extension window |
| `startAt` | Auction start time |
| `endAt` | Auction end time |

---

## Reserve price

The reserve price is evaluated during finalization.

A simplified rule:

```text
highestBid >= reservePrice
        │
        ├── yes → auction may close successfully
        │
        └── no  → RESERVE_NOT_MET
```

The reserve price should be checked by the backend immediately before final settlement.

---

## Minimum participants

If the configured minimum participant count is not reached, the auction can be moved to:

```text
CANCELED_INSUFFICIENT_BIDDERS
```

The system should evaluate participant eligibility rather than blindly counting WebSocket connections.

---

# Location Support

Auction records support location metadata:

```text
address
latitude
longitude
```

This enables location-aware auction experiences and integration with OpenStreetMap-compatible mapping interfaces.

The backend should treat latitude/longitude as data associated with the auction rather than as an authorization mechanism.

Location data can later support:

- Distance-based search
- Map browsing
- Nearby auctions
- Regional filtering
- Location-based recommendations

---

# Data Model

The core relational model is centered around:

```text
User
 │
 ├── Session
 ├── Auction
 ├── Bid
 ├── AuctionSubscription
 └── DepositRequest

Auction
 │
 ├── Seller → User
 ├── Bid[]
 └── AuctionSubscription[]
```

---

## User

A user contains identity, profile, session, wallet, and activity information.

Important concepts include:

- Google identity
- Email
- Username
- Phone
- Role
- Account status
- Wallet balance
- Frozen balance
- Session history
- Seller auctions
- Bids
- Subscriptions
- Deposit requests

---

## Auction

An auction contains:

- Product information
- Images
- Category
- Pricing
- Reserve rules
- Participation rules
- Seller
- Timing
- Location
- Lifecycle state
- Closure configuration

---

## Bid

A bid belongs to:

```text
User + Auction
```

and stores:

```text
amount
createdAt
auctionId
userId
```

The bid history provides the persistent record of bidding activity.

---

## AuctionSubscription

Subscriptions connect:

```text
User ↔ Auction
```

with a unique constraint:

```text
@@unique([userId, auctionId])
```

This prevents the same user from subscribing to the same auction more than once.

---

## DepositRequest

Deposit requests connect a user with a funding operation and provide an administrative approval state.

---

# Concurrency & Consistency

Real-time auctions are inherently concurrent.

Multiple bidders can submit requests within milliseconds of each other.

A robust implementation must therefore assume:

```text
Bidder A ──────┐
               ├──> same auction
Bidder B ──────┤
               │
Bidder C ──────┘
```

The server must not rely on the sequence in which WebSocket packets happen to arrive at individual clients.

---

## Bid consistency

A bid should be validated against the latest authoritative auction state.

For example:

```text
currentPrice = 500,000
bidIncrement = 10,000

minimum valid bid = 510,000
```

If two bids arrive simultaneously, the database operation must prevent an invalid state such as:

```text
currentPrice
    ↓
500,000

Bid A → 510,000
Bid B → 510,000
```

when the business rule requires the second bid to be higher.

Use appropriate database transactions/locking or another server-side concurrency strategy.

---

## Idempotency

Lifecycle jobs and financial operations should be safe against retries.

For example, if a completion job runs twice:

```text
Job #1 → close auction
Job #2 → close auction again
```

Job #2 must not:

- pay the winner twice,
- release funds twice,
- charge the seller twice,
- create duplicate settlement records,
- or transition an already finalized auction incorrectly.

---

# Configuration

Environment variables should be provided through a local `.env` file and must never be committed to source control.

A typical configuration includes:

```env
DATABASE_URL=
DIRECT_URL=

REDIS_URL=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=

SESSION_SECRET=

NODE_ENV=
PORT=
```

The exact variables depend on the implementation and deployment environment.

---

# Local Development

## Prerequisites

Install:

- Node.js
- npm
- PostgreSQL or a Neon PostgreSQL database
- Redis

For local Redis, Docker is recommended.

---

## Install dependencies

```bash
npm install
```

---

## Configure environment

Create:

```text
.env
```

and provide the required environment variables.

Do not commit secrets.

---

## Prisma

Generate the Prisma client:

```bash
npx prisma generate
```

Run migrations:

```bash
npx prisma migrate dev
```

Inspect the database:

```bash
npx prisma studio
```

---

## Start the API

Development:

```bash
npm run start:dev
```

Production build:

```bash
npm run build
```

Production:

```bash
npm run start:prod
```

---

# Database & Prisma

The project uses Prisma with PostgreSQL.

The database configuration follows the standard Prisma structure:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

For Neon deployments, keeping a separate direct connection URL is useful for Prisma operations that require a direct database connection.

---

# Background Workers

BullMQ workers should be treated as independent backend processes.

A production topology can look like:

```text
                    ┌─────────────────┐
                    │   NestJS API    │
                    └────────┬────────┘
                             │
                       Redis / Queue
                             │
                ┌────────────▼────────────┐
                │       BullMQ            │
                │        Queue             │
                └────────────┬────────────┘
                             │
                ┌────────────▼────────────┐
                │      Worker(s)           │
                │ Auction lifecycle        │
                │ Settlement / cleanup     │
                └─────────────────────────┘
```

Workers can be scaled independently from API instances.

---

# Production Architecture

A scalable deployment can be organized as:

```text
                         Internet
                            │
                     Load Balancer
                            │
               ┌────────────┴────────────┐
               │                         │
        ┌──────▼──────┐           ┌──────▼──────┐
        │ API Instance│           │ API Instance│
        │   NestJS    │           │   NestJS    │
        └──────┬──────┘           └──────┬──────┘
               │                         │
               └──────────┬──────────────┘
                          │
                 ┌────────▼────────┐
                 │      Redis      │
                 │ Cache / Queue / │
                 │ Realtime adapter│
                 └────────┬────────┘
                          │
                ┌─────────▼─────────┐
                │     BullMQ        │
                │      Workers      │
                └─────────┬─────────┘
                          │
                 ┌────────▼────────┐
                 │   PostgreSQL     │
                 │   Neon Database  │
                 └──────────────────┘
```

When multiple Socket.IO instances are deployed, a shared Redis-based adapter/coordination strategy is required so that events can reach clients connected to different API instances.

---

# Security Considerations

Security is particularly important because Ezuction contains both financial state and competitive auction state.

## Never trust the client

The client must not be trusted for:

- Wallet balance
- Auction status
- User role
- Seller identity
- Bid validity
- Participant eligibility
- Auction end time
- Reserve-price validation
- Winner selection

These are server-side concerns.

---

## Session security

Sessions should use:

- Secure cookies in production
- `HttpOnly`
- Appropriate `SameSite` policy
- Expiration
- Revocation
- Server-side validation

Sensitive session data should never be exposed to browser JavaScript unnecessarily.

---

## Authorization

Every protected operation should verify the user's actual authorization.

For example:

```text
Can this user modify this auction?

NOT:

Is this user authenticated?
```

Authentication and authorization are separate concerns.

---

## Financial operations

Financial mutations should:

- Use database transactions
- Validate current state
- Prevent negative balances
- Be idempotent where retries are possible
- Avoid trusting Redis as financial truth
- Prevent duplicate approval/settlement
- Record enough state to audit important operations

---

# Operational Considerations

## Redis failure

Critical persistent data should remain recoverable from PostgreSQL.

Redis should be treated as:

```text
fast
temporary
reconstructible
```

rather than the only source of truth for critical business data.

---

## Worker failure

BullMQ retries should not produce duplicate business effects.

Auction transitions must be guarded by current database state.

A worker restart should not corrupt an auction.

---

## WebSocket disconnects

A disconnected bidder should not automatically imply that the user lost their auction rights.

The authoritative state remains:

```text
Database + server-side eligibility
```

not the state of an individual browser connection.

---

# Recommended Financial Evolution

For a production financial system, monetary values should ideally use an exact representation rather than binary floating-point values.

For example, consider using:

```text
Prisma Decimal
```

or storing currency in the smallest unit:

```text
integer minor units
```

For example:

```text
100.50
```

could be represented as:

```text
10050
```

This avoids floating-point precision issues.

A mature wallet architecture can also introduce an immutable transaction/ledger model:

```text
Wallet
  │
  └── WalletTransaction[]
          │
          ├── DEPOSIT
          ├── RESERVATION
          ├── RELEASE
          ├── SETTLEMENT
          ├── REFUND
          └── PENALTY
```

This makes financial auditing and reconciliation significantly safer than relying only on aggregate balance fields.

---

# Recommended Auction Settlement Model

The final auction operation should conceptually behave as a single business transaction:

```text
1. Lock/validate auction
2. Verify auction is still finalizable
3. Determine eligible winner
4. Verify highest valid bid
5. Verify reserve price
6. Verify required participant funds
7. Apply buyer-side settlement
8. Apply seller-side settlement
9. Release/refund non-winning reservations
10. Persist final auction state
11. Persist financial transactions
12. Commit
13. Publish real-time completion event
```

The real-time notification should happen **after** the authoritative database transaction succeeds.

This prevents clients from seeing a successful auction result that was later rolled back.

---

# Observability

For production operation, the backend should expose enough information to diagnose auction and financial incidents.

Recommended logging dimensions include:

```text
requestId
userId
auctionId
bidId
jobId
queue
event
timestamp
```

Sensitive credentials, cookies, payment information, and private session data must never be logged.

Metrics worth tracking include:

- Active auctions
- Live auctions
- Bid rate
- WebSocket connections
- Bid rejection rate
- Queue latency
- Failed jobs
- Auction completion failures
- Deposit approval volume
- Redis latency
- Database latency

---

# Engineering Principles

Ezuction is designed around several principles:

### 1. PostgreSQL owns durable business state

If something must survive a restart, it should have a persistent representation.

### 2. Redis accelerates the system

Use Redis for speed, coordination, temporary state, and derived information — not as a replacement for durable financial truth.

### 3. The server owns auction time

Browser countdowns are visual only.

Auction transitions are controlled by the backend.

### 4. WebSockets are transport, not authority

Socket.IO delivers events quickly, but all important decisions happen server-side.

### 5. Workers must be retry-safe

Background processing is expected to be retried or duplicated under failure conditions.

Business operations therefore need idempotency.

### 6. Financial operations are atomic

A wallet reservation or settlement should never leave the system halfway between two states.

### 7. Authentication is not authorization

Being logged in does not automatically mean a user can perform a specific auction operation.

---

# Project Status

Ezuction is under active development.

Current backend capabilities include:

- [x] NestJS backend
- [x] PostgreSQL / Prisma
- [x] User accounts
- [x] Google OAuth 2.0
- [x] Session management
- [x] Guards and authorization
- [x] User wallet
- [x] Frozen wallet balance
- [x] Deposit requests
- [x] Admin approval workflow
- [x] Auction management
- [x] Auction subscriptions
- [x] Bidding
- [x] Socket.IO real-time communication
- [x] Redis integration
- [x] BullMQ background processing
- [x] Scheduled auction lifecycle
- [x] Fixed / soft closure concepts
- [x] Reserve-price validation
- [x] Participant requirements
- [x] Seller-side deposit concept
- [x] Location metadata / OpenStreetMap integration
- [ ] Frontend documentation
- [ ] Full financial ledger/audit layer
- [ ] Production payment gateway integration
- [ ] Extended observability and operational tooling

The checklist intentionally reflects the backend scope and may change as the product evolves.

---

# License

This project is proprietary unless a license is explicitly added to the repository.

Copyright © Ezuction.
