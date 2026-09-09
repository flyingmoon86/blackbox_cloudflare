INSERT OR REPLACE INTO user (
  id, username, password_hash, email, auth_version, role, status
) VALUES (
  900001,
  'phase0-admin',
  'scrypt:32768:8:1$phase0salt$a890e2f1dd05a29e1bbb5cf3eb2aa3b7e7d0b6dc516743896f6412565a663b628ba3c727d8c746c5fb2075a2f5230e3d5e9160d5782ab2b0277aa9cac6650cb5',
  'phase0-admin@example.invalid',
  0,
  'admin',
  'active'
);

INSERT OR REPLACE INTO user (
  id, username, password_hash, email, auth_version, role, status
) VALUES (
  900002,
  'admin',
  'scrypt:32768:8:1$11208eee03d6a0b379d3ac551b0e7b28$cfe9a9942582e951d4157e6359e6828ac06451d03166c2ab97c9c86a6076f36c4507f34311d09b8eb5df775d7453e5b64ebe37319727642f6212159c2b2d3138',
  NULL,
  0,
  'admin',
  'active'
);
