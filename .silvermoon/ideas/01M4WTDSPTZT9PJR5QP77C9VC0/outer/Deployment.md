# Deployment

## Steps

### D-S01: Select the service home and operating owner

Choose the repository, hosting environment, service owner, and operational boundary with the intended consumers; this decision is intentionally open during idea preparation.

### D-S02: Establish protected identity, payload, and key operations

Configure authentication, payload access and retention controls, database audit protections, signing-key lifecycle, and distribution of versioned verifier trust bundles.

### D-S03: Pilot caller integration and recovery behavior

Integrate a PGH caller and one independent verifier, then exercise online request handling, matching-payload offline verification, withdrawal, and compromised-key status handling.

## Acceptance criteria

### D-AC01: Ownership and deployment boundary are explicit

The chosen service repository, environment, owner, and support boundary are documented and approved by the responsible stakeholders; prove this with the deployment record and owner sign-off.

### D-AC02: Consumers can verify decisions safely

A deployed pilot blocks on pending requests and releases only for an authenticated decision credential whose signature and expected payload digest match; prove this with end-to-end traces and independent offline verifier results that identify the trust-bundle version.

### D-AC03: Operational safeguards are exercised

Operators demonstrate access auditing, payload protection, key rotation and compromised-key handling, plus restoration of request/audit state; prove this with reviewed runbooks and recorded recovery exercises.
