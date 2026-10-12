// 物資入庫 — standalone page wrapper around the shared SupplyItemForm.
// Same behavior as the old 物資管理 "新增物資" modal, promoted to its own
// menu page so stock-in has a dedicated, bookmarkable entry point.
import { Link, useNavigate } from 'react-router-dom'
import { SupplyItemForm } from '../components/SupplyItemForm'
import { useAuth } from '../hooks/useAuth'
import { Roles } from '../lib/enums'

export function StockIn() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const isAdmin = profile?.role_name === Roles.Admin
  // 物資清單僅總管可看；幫主入庫成功後回物資總覽。
  const afterSaved = isAdmin ? '/supply-items' : '/'

  return (
    <div className="container mt-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2>
          <i className="bi bi-box-arrow-in-down" /> 物資入庫
        </h2>
        {isAdmin && (
          <Link className="btn btn-outline-secondary" to="/supply-items">
            <i className="bi bi-list-ul" /> 物資清單
          </Link>
        )}
      </div>

      <div className="card shadow-sm">
        <div className="card-body">
          <SupplyItemForm onSaved={(m) => navigate(afterSaved, { state: { flash: m } })} submitLabel="確認入庫" />
        </div>
      </div>
    </div>
  )
}
