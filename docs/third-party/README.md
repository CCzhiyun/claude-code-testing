# Dependency license evidence, not project redistribution approval

The npm artifact for `js-tiktoken@1.0.21` declares MIT but did not include a
standalone LICENSE in the inspected installation. Its published npm metadata
identifies gitHead `4c8b748e07992c00386f3180af5c574b27b65139` and repository
`https://github.com/dqbd/tiktoken`.

The adjacent license is retained from that exact upstream commit:
https://raw.githubusercontent.com/dqbd/tiktoken/4c8b748e07992c00386f3180af5c574b27b65139/LICENSE

Published archive integrity in package-lock.json:
`sha512-biOj/6M5qdgx5TKjDnFT1ymSpM5tbd3ylwDtrQvFQSu0Z7bBYko2dF+W/aUkXUPuk6IVpRxk/3Q2sHOzGlS36g==`.

The bundled `ws` and transitive `base64-js` artifacts retain their own LICENSE
files under node_modules in the npm archive. These are dependency-specific
materials, not an exhaustive project NOTICE, provenance attestation, an
authenticated supply-chain review, or authorization to redistribute the
original project/third-party integrations. The release approval gate remains
closed until the actual source-rights and distribution review is supplied.
