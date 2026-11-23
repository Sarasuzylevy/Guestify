# Guestify Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **User Ownership & PII Isolation**: A `users/{userId}` document can only be created, read, or updated by the verified user whose `request.auth.uid == userId`. No user can read or list another user's private profile or email.
2. **Non-PII Public Search Directory**: `publicProfiles/{userId}` contains strictly non-PII fields (`uid`, `displayName`, `acronym`, `searchable`, `createdAt`, `updatedAt`) and can only be written by `request.auth.uid == userId`.
3. **Wedding Project Master Gate**: A `weddings/{weddingId}` document belongs exclusively to `ownerUid == request.auth.uid`. Every subcollection under it (`/tasks/{taskId}`, `/guests/{guestId}`) verifies parent ownership via `get(/databases/$(database)/documents/weddings/$(weddingId)).data.ownerUid == request.auth.uid`.
4. **Invitation Cross-User Integrity**: An `invitations/{invitationId}` document can only be created or deleted by `organizerUid == request.auth.uid` (and `exists(/databases/$(database)/documents/weddings/$(incoming().weddingId))`). An invited guest (`guestEmail == request.auth.token.email` with `email_verified == true`, or `guestUid == request.auth.uid`) may ONLY read the invitation and update `['status', 'lastUpdated', 'updatedAt']` — never modifying `organizerUid`, `weddingId`, `guestEmail`, or wedding details.
5. **Vendor Showcase & Private Contact Separation**: `vendors/{vendorId}` contains only showcase fields (no email/phone PII) and can only be created/updated/deleted by `ownerUid == request.auth.uid`. Private contact details reside in `vendors/{vendorId}/private/{docId}` and are strictly restricted to the vendor owner.
6. **Interaction Collection Integrity**: `vendors/{vendorId}/likes/{likeId}` requires `userUid == request.auth.uid` and `exists(/databases/$(database)/documents/vendors/$(vendorId))`, preventing spoofed likes on behalf of other users.
7. **Temporal & Immutable Integrity**: All `createdAt` on create and `updatedAt` on create/update must equal `request.time`. Immutable owner/parent IDs cannot change after creation.
8. **Direct Chat Participant Isolation**: A `vendorChats/{chatId}` document can only be read or updated by its two verified participants (`coupleUid == request.auth.uid` or `vendorOwnerUid == request.auth.uid`), and creation validates that `vendorId` exists and `vendorOwnerUid` matches `/vendors/{vendorId}.data.ownerUid`.
9. **Chat Message Master Gate & Atomicity**: Messages in `vendorChats/{chatId}/messages/{messageId}` require `senderUid == request.auth.uid`, valid `recipientUid` matching the counterparty, and atomic parent chat update via `getAfter` so message streams and thread previews never desync.
10. **Email RSVP Guest Verification**: Signed-in users updating `rsvpTokens/{token}` status cannot be the organizer and must have a verified `request.auth.token.email` matching `guestEmail`.
11. **Zero-PII Email Directory Lookup**: `emailDirectory/{emailHash}` stores only `{ emailHash, uid, createdAt, updatedAt }` where `emailHash` is the 64-char lowercase SHA-256 hex digest of a user's verified email (`hashing.sha256(request.auth.token.email.lower().toUtf8()).toHexString().lower()`). Listing is strictly forbidden (`allow list: if false`); verified users may only perform single-document `get` lookups by exact hash, and only the verified email owner may create their own entry.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated User Read**: Unauthenticated client calls `getDoc(doc(db, 'users', 'u1'))` -> `PERMISSION_DENIED`.
2. **Cross-User PII Read**: User B (`uid: u2`) calls `getDoc(doc(db, 'users', 'u1'))` -> `PERMISSION_DENIED`.
3. **Blanket Users List Scrape**: User B calls `getDocs(collection(db, 'users'))` -> `PERMISSION_DENIED`.
4. **Unverified Email Write**: User with `email_verified: false` attempts to create a `weddings/wed_u2` document -> `PERMISSION_DENIED`.
5. **Identity Spoofing on Wedding Create**: User B sets `ownerUid: 'u1'` when creating `weddings/wed_u1` -> `PERMISSION_DENIED`.
6. **Shadow Ghost Field Injection**: User A creates `weddings/wed_u1` with extra ghost field `isAdmin: true` -> `PERMISSION_DENIED`.
7. **Orphaned Task Creation**: User B tries to create a task under `weddings/wed_u1/tasks/t1` where `u1` owns `wed_u1` -> `PERMISSION_DENIED`.
8. **Guest Tampering Invitation Terms**: Invited guest attempts to update `organizerUid` or `wedding` inside `invitations/inv1` -> `PERMISSION_DENIED`.
9. **Unauthorized Invitation Delete**: Invited guest attempts to `deleteDoc` on `invitations/inv1` -> `PERMISSION_DENIED`.
10. **Vendor Hijack Update**: User B attempts to `updateDoc` on `vendors/vnd_u1` owned by User A -> `PERMISSION_DENIED`.
11. **Vendor Private Contact Leak**: User B calls `getDoc(doc(db, 'vendors', 'vnd_u1', 'private', 'contact'))` -> `PERMISSION_DENIED`.
12. **Client Timestamp Forgery / ID Poisoning**: User A sets `createdAt: "2020-01-01"` (not `request.time`) or uses a 1500-char ID string -> `PERMISSION_DENIED`.
13. **Chat Eavesdropping**: User C (`u3`) calls `getDoc` or `getDocs` on `vendorChats/chat_u1_vnd1/messages` -> `PERMISSION_DENIED`.
14. **Vendor Owner Spoofing on Chat Create**: User A sets `vendorOwnerUid: 'attacker'` when starting a chat with `vendors/vnd1` -> `PERMISSION_DENIED`.
15. **Message Impersonation**: Participant A tries to send a message with `senderUid: vendorOwnerUid` -> `PERMISSION_DENIED`.
16. **Email Directory Scraping**: Verified user calls `getDocs(collection(db, 'emailDirectory'))` -> `PERMISSION_DENIED`.
17. **Email Hash Spoofing**: User B attempts to create `emailDirectory/{sha256(victim@gmail.com)}` with `uid: u2` -> `PERMISSION_DENIED` (hash does not match `request.auth.token.email`).
18. **Email Directory PII Injection**: User A attempts to store a shadow field `email: "a@b.com"` inside `emailDirectory/{hash}` -> `PERMISSION_DENIED`.
