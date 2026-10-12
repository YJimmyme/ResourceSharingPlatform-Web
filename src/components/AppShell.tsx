// Direct port of Views/Shared/_Layout.cshtml's nav structure. Bootstrap's JS
// (dropdown toggle) is loaded globally in main.tsx, so the same
// data-bs-toggle="dropdown" markup works here without a React dropdown library.
import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabaseClient'
import { locationColorStyle } from '../lib/colors'
import { Roles, roleDisplayName } from '../lib/enums'
import { useEngineeringMode } from '../hooks/useEngineeringMode'
import { APP_VERSION } from '../lib/version'

export function AppShell() {
  const { profile, signOut } = useAuth()
  const isAdmin = profile?.role_name === Roles.Admin
  const isAdminOrCadre = profile?.role_name === Roles.Admin || profile?.role_name === Roles.Cadre
  const isSocialWorker = profile?.role_name === Roles.SocialWorker
  const { enabled: engineeringMode, setEnabled: setEngineeringMode } = useEngineeringMode()

  // 顯示這隻帳號所屬據點名稱（純顯示，不是連結）。
  const [myLocationName, setMyLocationName] = useState<string | null>(null)
  useEffect(() => {
    if (profile?.location_id == null) { setMyLocationName(null); return }
    supabase
      .from('supply_location')
      .select('location_name')
      .eq('id', profile.location_id)
      .maybeSingle()
      .then(({ data }) => setMyLocationName((data as { location_name: string } | null)?.location_name ?? null))
  }, [profile?.location_id])

  return (
    <>
      {engineeringMode && (
        <div className="alert alert-warning rounded-0 border-0 mb-0 py-2 d-flex justify-content-between align-items-center">
          <span><i className="bi bi-tools" /> <strong>工程模式</strong>－開發中功能僅在此瀏覽器顯示</span>
          <button type="button" className="btn btn-sm btn-outline-dark" onClick={() => setEngineeringMode(false)}>離開工程模式</button>
        </div>
      )}
      <header>
        <nav className="navbar navbar-expand-sm navbar-dark bg-primary border-bottom box-shadow mb-3">
          <div className="container-fluid">
            <NavLink className="navbar-brand" to="/">
              <i className="bi bi-box-seam" /> 愛心轉運站
            </NavLink>
            <button
              className="navbar-toggler"
              type="button"
              data-bs-toggle="collapse"
              data-bs-target=".navbar-collapse"
            >
              <span className="navbar-toggler-icon" />
            </button>
            <div className="navbar-collapse collapse d-sm-inline-flex justify-content-between">
              <ul className="navbar-nav flex-grow-1">
                <li className="nav-item">
                  <NavLink className="nav-link text-white" to="/">
                    <i className="bi bi-speedometer2" /> 物資總覽
                  </NavLink>
                </li>
                <li className="nav-item dropdown">
                  <a className="nav-link dropdown-toggle text-white" href="#" role="button" data-bs-toggle="dropdown">
                    <i className="bi bi-box" /> 物資管理
                  </a>
                  <ul className="dropdown-menu">
                    {isAdminOrCadre && (
                      <li>
                        <NavLink className="dropdown-item" to="/stock-in">
                          <i className="bi bi-box-arrow-in-down" /> 物資入庫
                        </NavLink>
                      </li>
                    )}
                    <li>
                      <NavLink className="dropdown-item" to="/outbound/create">
                        <i className="bi bi-box-arrow-up" /> 物資領用
                      </NavLink>
                    </li>
                    {isAdmin && (
                      <li>
                        <NavLink className="dropdown-item" to="/disposals/create">
                          <i className="bi bi-trash3" /> 物資報廢
                        </NavLink>
                      </li>
                    )}
                    {isAdminOrCadre && (
                      <li>
                        <NavLink className="dropdown-item" to="/transfers/create">
                          <i className="bi bi-arrow-left-right" /> 物資轉移
                        </NavLink>
                      </li>
                    )}
                    {isAdminOrCadre && (
                      <li>
                        <NavLink className="dropdown-item" to="/ai-stockin/create">
                          <i className="bi bi-stars" /> AI 智慧入庫
                        </NavLink>
                      </li>
                    )}
                  </ul>
                </li>
                <li className="nav-item dropdown">
                  <a className="nav-link dropdown-toggle text-white" href="#" role="button" data-bs-toggle="dropdown">
                    <i className="bi bi-journal-text" /> 紀錄查詢
                  </a>
                  <ul className="dropdown-menu">
                    <li>
                      <NavLink className="dropdown-item" to="/outbound">
                        <i className="bi bi-box-arrow-up" /> {isSocialWorker ? '個人領用紀錄' : '領用紀錄'}
                      </NavLink>
                    </li>
                    {isAdmin && (
                      <li>
                        <NavLink className="dropdown-item" to="/donations">
                          <i className="bi bi-award" /> 捐贈紀錄
                        </NavLink>
                      </li>
                    )}
                    {isAdminOrCadre && (
                      <li>
                        <NavLink className="dropdown-item" to="/disposals">
                          <i className="bi bi-trash3" /> 報廢紀錄
                        </NavLink>
                      </li>
                    )}
                    {isAdminOrCadre && (
                      <li>
                        <NavLink className="dropdown-item" to="/transfers">
                          <i className="bi bi-arrow-left-right" /> 轉移紀錄
                        </NavLink>
                      </li>
                    )}
                    {isAdmin && (
                      <li>
                        <NavLink className="dropdown-item" to="/ai-stockin">
                          <i className="bi bi-stars" /> AI 辨識紀錄
                        </NavLink>
                      </li>
                    )}
                    {isAdmin && (
                      <>
                        <li><hr className="dropdown-divider" /></li>
                        <li>
                          <NavLink className="dropdown-item" to="/outbound/recipient-analysis">
                            <i className="bi bi-graph-up" /> 領取分析
                          </NavLink>
                        </li>
                        <li>
                          <NavLink className="dropdown-item" to="/donations/donor-analysis">
                            <i className="bi bi-heart" /> 捐贈分析
                          </NavLink>
                        </li>
                        <li>
                          <NavLink className="dropdown-item" to="/analytics">
                            <i className="bi bi-bar-chart-line" /> 分析中心
                          </NavLink>
                        </li>
                      </>
                    )}
                  </ul>
                </li>
                {engineeringMode && (
                  <li className="nav-item">
                    <NavLink className="nav-link text-warning fw-bold" to="/engineering/mobile-features">
                      <i className="bi bi-phone" /> 手機網頁功能
                    </NavLink>
                  </li>
                )}
                {isAdminOrCadre && (
                  <li className="nav-item dropdown">
                    <a className="nav-link dropdown-toggle text-white" href="#" role="button" data-bs-toggle="dropdown">
                      <i className="bi bi-gear" /> 系統管理
                    </a>
                    <ul className="dropdown-menu">
                      {/* 物資明細開放幫主（可調整）；其餘系統設定僅總管。 */}
                      {isAdmin && (
                        <li>
                          <NavLink className="dropdown-item" to="/supply-items">
                            <i className="bi bi-boxes" /> 物資清單
                          </NavLink>
                        </li>
                      )}
                      <li>
                        <NavLink className="dropdown-item" to="/item-ledger">
                          <i className="bi bi-clock-history" /> 物資明細
                        </NavLink>
                      </li>
                      {isAdmin && (
                      <><li><hr className="dropdown-divider" /></li>
                      <li>
                        <NavLink className="dropdown-item" to="/admin/accounts">
                          <i className="bi bi-people" /> 帳號管理
                        </NavLink>
                      </li>
                      <li>
                        <NavLink className="dropdown-item" to="/supply-locations">
                          <i className="bi bi-buildings" /> 據點管理
                        </NavLink>
                      </li>
                      <li>
                        <NavLink className="dropdown-item" to="/admin/inventory-types">
                          <i className="bi bi-card-list" /> 庫存種類設定
                        </NavLink>
                      </li>
                      <li>
                        <NavLink className="dropdown-item" to="/admin/line-settings">
                          <i className="bi bi-chat-dots" /> LINE 通知設定
                        </NavLink>
                      </li>
                      <li>
                        <NavLink className="dropdown-item" to="/admin/line-broadcast">
                          <i className="bi bi-megaphone" /> LINE 物資通報
                        </NavLink>
                      </li>
                      <li>
                        <NavLink className="dropdown-item" to="/admin/vision-training">AI 模型管理</NavLink>
                        <NavLink className="dropdown-item" to="/admin/ai-settings">
                          <i className="bi bi-stars" /> AI 智慧入庫設定
                        </NavLink>
                      </li>
                      <li><hr className="dropdown-divider" /></li>
                      <li>
                        <NavLink className="dropdown-item" to="/admin/activity-log">
                          <i className="bi bi-clipboard-data" /> 操作紀錄
                        </NavLink>
                      </li></>
                      )}
                    </ul>
                  </li>
                )}
              </ul>
              <ul className="navbar-nav">
                {/* 顯示這隻帳號所屬據點（純顯示＋對應色塊，通常是幫主／小幫手）。 */}
                {myLocationName && profile?.location_id != null && (
                  <li className="nav-item d-flex align-items-center me-3">
                    <span className="badge" style={locationColorStyle(profile.location_id)}>
                      <i className="bi bi-geo-alt" /> {myLocationName}
                    </span>
                  </li>
                )}
                <li className="nav-item d-flex align-items-center text-white me-3">
                  <i className="bi bi-person-circle" />
                  <span className="ms-1">{profile?.display_name ?? profile?.username}</span>
                  <span className="badge bg-light text-dark ms-2">{roleDisplayName(profile?.role_name)}</span>
                </li>
                <li className="nav-item">
                  <button type="button" className="btn btn-sm btn-outline-light" onClick={() => void signOut()}>
                    <i className="bi bi-box-arrow-right" /> 登出
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </nav>
      </header>
      <div className="container-fluid">
        <main role="main" className="pb-3">
          <Outlet />
        </main>
      </div>
      <footer className="border-top footer text-muted mt-5 py-3 bg-light">
        <div className="container">
          <div className="row">
            <div className="col-md-6">&copy; 2026 - 愛心轉運站　<span className="badge bg-secondary">{APP_VERSION}</span></div>
            <div className="col-md-6 text-end">
              <i className="bi bi-info-circle" /> 用於管理地方據點物資現況、庫存數量、有效期限與轉移紀錄
            </div>
          </div>
        </div>
      </footer>
    </>
  )
}
