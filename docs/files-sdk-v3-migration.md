# Files SDK 3 migration

AgentPond's storage integrations now use Files SDK 3.1.0. Use Node.js 22 or
later. If you supply a Files client to `@agentpond/files-sdk`, upgrade your
application's `files-sdk` dependency to `^3.1.0` alongside AgentPond.

Firebase, Supabase, and Vercel continue to own their credentials, bucket
selection, and prefixes. AgentPond environment files and stored traces do not
need migration. JSON uploads, explicit downloads, and prefix listing use the
same AgentPond APIs.

Files SDK 3 returns metadata from `head()` and listing operations: read
`contentType` instead of `type`, and use `download()` to read bytes. Applications
using other Files SDK APIs should also review the
[upstream migration notes](https://files-sdk.dev/changelog/files-sdk-3-0-0).

Files SDK 3.1 accepts `@google-cloud/storage` 7 or 8. Firebase still obtains its
bucket through `firebase-admin/storage`; it does not construct a separate GCS
client. Consumers using Firebase Admin with Storage 8 no longer need the
Files SDK 2 peer-warning note, a downgrade to Storage 7, or a peer allowance.

Other storage SDKs remain optional peers of Files SDK. Install peers required
by your selected adapter. If an installed optional peer is outside its declared
range, resolve that version mismatch rather than suppressing the warning.
