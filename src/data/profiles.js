/** 個人檔案資料模組。 */

import * as repo from './repository.js';

export const getProfile = (userId) => repo.getProfile(userId);
export const listProfiles = () => repo.listProfiles();
export const updateProfile = (id, patch) => repo.updateProfile(id, patch);
export const setUserRole = (id, role) => repo.setUserRole(id, role);

export const isAdmin = (profile) => profile?.role === 'admin';
