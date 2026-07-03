import React, { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../config/api';
import fetchWithRetry from '../utils/fetchWithRetry';
import Toast from './Toast';
import ConfirmModal from './ConfirmModal';
import LoadingScreen from './LoadingScreen';
interface User {
  id: number;
  username: string;
  email: string | null;
  role: string;
  oauth_provider: string | null;
  created_at: string;
}

export default function UserManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [currentUserRole, setCurrentUserRole] = useState<string>('user');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ userId: number; username: string } | null>(null);

  useEffect(() => {
    fetchUsers();
    fetchCurrentUserRole();
  }, []);

  const fetchCurrentUserRole = async () => {
    try {
      const response = await fetchWithRetry('/api/auth/me', { credentials: 'include' });
      const data = await response.json();
      setCurrentUserRole(data.role || 'user');
    } catch (err) {
      console.error('Failed to fetch current user role:', err);
    }
  };

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await fetchWithRetry(API_ENDPOINTS.USERS.ADMIN_LIST, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch users');
      const data = await response.json();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (userId: number, newRole: string) => {
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.USERS.ADMIN_UPDATE_ROLE(userId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
        credentials: 'include'
      });
      
      if (!response.ok) throw new Error('Failed to update role');
      
      fetchUsers();
      setToast({ message: 'User role updated successfully', type: 'success' });
    } catch (err) {
      setToast({ message: 'Failed to update role: ' + (err instanceof Error ? err.message : 'Unknown error'), type: 'error' });
    }
  };

  const handleDeleteClick = (userId: number, username: string) => {
    setConfirmDelete({ userId, username });
  };

  const handleDeleteUser = async () => {
    if (!confirmDelete) return;
    
    const { userId, username } = confirmDelete;
    setConfirmDelete(null);
    
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.USERS.ADMIN_DELETE(userId), {
        method: 'DELETE',
        credentials: 'include'
      });
      
      if (!response.ok) throw new Error('Failed to delete user');
      
      fetchUsers();
      setToast({ message: 'User deleted successfully', type: 'success' });
    } catch (err) {
      setToast({ message: 'Failed to delete user: ' + (err instanceof Error ? err.message : 'Unknown error'), type: 'error' });
    }
  };

  if (loading) {
    return <LoadingScreen message="Loading users..." />;
  }

  if (error) {
    return (
      <div className="rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
        <p>Error: {error}</p>
      </div>
    );
  }

  return (
    <div>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <div className="overflow-x-auto rounded-lg bg-card shadow-sm">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="[&>th]:border-b [&>th]:border-line [&>th]:px-4 [&>th]:py-2.5 [&>th]:text-left [&>th]:text-xs [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-muted">
              <th>Username</th>
              <th>Email</th>
              <th>Auth Method</th>
              <th>Role</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody className="[&>tr]:border-b [&>tr]:border-line [&>tr:last-child]:border-b-0 [&_td]:px-4 [&_td]:py-2.5 [&_td]:text-fg-soft">
            {users.map(user => (
              <tr key={user.id}>
                <td className="font-medium text-fg">{user.username}</td>
                <td>{user.email || '-'}</td>
                <td>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${user.oauth_provider ? 'bg-info/15 text-info' : 'bg-white/8 text-fg-soft'}`}>
                    {user.oauth_provider || 'Local'}
                  </span>
                </td>
                <td>
                  <select
                    className="min-h-9 w-auto text-xs"
                    value={user.role}
                    onChange={(e) => handleRoleChange(user.id, e.target.value)}
                    disabled={user.role === 'superadmin' && currentUserRole !== 'superadmin'}
                    title={user.role === 'superadmin' && currentUserRole !== 'superadmin' ? 'Only superadmins can change superadmin roles' : ''}
                  >
                    {currentUserRole === 'superadmin' && <option value="superadmin">Super Admin</option>}
                    <option value="admin">Admin</option>
                    <option value="user">User</option>
                  </select>
                </td>
                <td className="tabular-nums">{new Date(user.created_at).toLocaleDateString()}</td>
                <td>
                  <button
                    className="inline-flex size-9 items-center justify-center rounded-md bg-danger/15 text-danger transition-colors hover:bg-danger/25 disabled:pointer-events-none disabled:opacity-40"
                    onClick={() => handleDeleteClick(user.id, user.username)}
                    disabled={user.role === 'superadmin' || (user.role === 'admin' && users.filter(u => u.role === 'admin' || u.role === 'superadmin').length === 1)}
                    title={user.role === 'superadmin' ? 'Cannot delete superadmin' : (user.role === 'admin' && users.filter(u => u.role === 'admin' || u.role === 'superadmin').length === 1 ? 'Cannot delete the last admin' : 'Delete user')}
                  >
                    🗑️
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-muted">
        <p>Total Users: {users.length}</p>
        <p>Admins: {users.filter(u => u.role === 'admin' || u.role === 'superadmin').length}</p>
        <p>Regular Users: {users.filter(u => u.role === 'user').length}</p>
      </div>

      <ConfirmModal
        isOpen={!!confirmDelete}
        title="Delete User"
        message={`Are you sure you want to delete user "${confirmDelete?.username}"?\n\nThis action cannot be undone.`}
        confirmText="Delete"
        confirmButtonClass="btn-delete"
        onConfirm={handleDeleteUser}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
