/**
 * The shape of a version the extension directory publishes: semver core with
 * an optional pre-release (`1.2.3`, `2.0.0-beta.1`). Build metadata is not
 * part of a published version and is refused with everything else.
 *
 * Shared by the connector registry (the `version` link parameter), the admin
 * login's `?next=` gate and the marketplace routes, so a version that passes
 * one passes all of them.
 */
export const RELEASE_VERSION = /^\d{1,9}\.\d{1,9}\.\d{1,9}(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
