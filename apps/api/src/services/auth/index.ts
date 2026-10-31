export { findUserById, loginUser, registerUser, toAuthenticatedUser } from './auth.js';

// Reads and writes other modules may use; the tables stay owned by this module.
export {
  findUserByEmail,
  findUserForUpdate,
  insertUser,
  updateUser,
} from './repositories/users.js';
