# E00 — Owner account and access

**Status:** To do

## Objective

Allow a person to securely access their character and its stories while keeping the human identity separate from credentials used by the external brain.

## Expected outcome

The owner has a verifiable account, can access only their own data, and can manage the human session and agent access separately.

## Stories

### AIT-001 — Create an owner account

**Priority:** P0 · **Increment:** A · **Status:** To do

As a new owner, I want to create an account so that I can create and follow my character.

**Acceptance criteria**

- A valid identity can create only one account for the same authenticated identifier.
- The system does not require the owner to share credentials for their LLM provider.
- Account creation records consent and the applicable terms version.
- A duplicate attempt does not create multiple accounts.
- Errors do not reveal whether data belonging to other people exists.

**Events and metrics:** `owner_account_created`, `owner_signup_failed`.

### AIT-002 — Access owned data

**Priority:** P0 · **Increment:** A · **Status:** To do

As an owner, I want to authenticate and see only my character so that I can safely follow its life.

**Acceptance criteria**

- A valid session identifies the owner for every protected operation.
- The owner cannot read or modify private data belonging to other characters.
- An expired or revoked session prevents new operations.
- Human sessions cannot be reused as permanent agent credentials.

**Events and metrics:** `owner_signed_in`, `owner_access_denied`.

**Dependencies:** AIT-001.

### AIT-003 — Sign out without stopping the character

**Priority:** P1 · **Increment:** A · **Status:** To do

As an owner, I want to sign out without stopping the external brain so that the character's life continues while I am away.

**Acceptance criteria**

- Ending the human session does not automatically revoke agent credentials.
- The world continues processing character activities and events.
- Signing in again exposes events that occurred during the absence.
- The owner can revoke the agent separately when desired.

**Events and metrics:** `owner_signed_out`, length of absence before returning.

**Dependencies:** AIT-002, AIT-201, AIT-801.

## Out of scope

- organizations with multiple administrators;
- multiple owners for one character;
- social features between human accounts.
