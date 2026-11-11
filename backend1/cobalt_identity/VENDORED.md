# cobalt-identity (vendored)

A copy of the SDK that verifies delegated identity tokens minted by Cobalt Core.

| | |
|---|---|
| Source | `ISOFT-LTD/Cobalt_Api`, folder `sdk/cobalt_identity/` |
| Version | 1.0.0 |
| Copied at Cobalt_Api commit | `8997c4b8` |

**Why a copy.** Cobalt_Api is a private repository, so installing the SDK from it
(`pip install "git+...#subdirectory=sdk"`) would need a GitHub credential inside
every Docker build of this service. The SDK is small, depends only on
`cryptography`, and changes rarely; a pinned copy keeps the build self-contained.

**Do not edit these files here.** Change the SDK in Cobalt_Api, then copy it
again and update the commit above:

```bash
cp ../Cobalt_Api/sdk/cobalt_identity/*.py backend/cobalt_identity/
```
