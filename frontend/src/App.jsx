import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  ScatterChart, Scatter, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend
} from 'recharts'
import {
  TrendingUp, TrendingDown, AlertTriangle, AlertCircle, CheckCircle2,
  Copy, Plus, Upload, Trash2, Filter, X, ChevronDown, ChevronRight,
  Info, Search, Database, ShieldCheck, Layers, PieChart as PieIcon,
  BarChart3, HelpCircle, Sparkles, Clock, MapPin, Calendar, DollarSign,
  RefreshCw, ArrowUpRight, ArrowDownRight, Tag, Zap
} from 'lucide-react'

const API = 'http://localhost:5000/api'

// ── Strict Color Palette with Meaning ──────────────────────────────────────
const COLOR_NORMAL = '#2563EB'       // Royal Blue for normal trend/primary spend
const COLOR_NORMAL_LIGHT = '#93C5FD' // Soft blue fill
const COLOR_DUPLICATE = '#DC2626'    // Vivid Red for duplicates / double-billing
const COLOR_ANOMALY = '#EA580C'      // Vivid Amber/Orange for anomalous spikes
const COLOR_NORMAL_ACCENT = '#059669'// Green for clean/pass audits
const COLOR_MUTED = '#64748B'        // Slate for secondary elements

const CATEGORY_PALETTE = [
  '#2563EB', '#0D9488', '#D97706', '#7C3AED',
  '#0284C7', '#DB2777', '#4F46E5', '#64748B'
]

function fmtCurr(n, cur = 'USD') {
  if (n === null || n === undefined || isNaN(n)) return `0.00 ${cur}`
  return `${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`
}

function fmtDate(d) {
  if (!d) return '—'
  return d.split('T')[0]
}

function parseItemsArray(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// ── Mini Sparkline Component for KPI Cards ─────────────────────────────────
function MiniSparkline({ data, color = COLOR_NORMAL }) {
  if (!data || data.length === 0) return null
  const chartData = data.map((v, i) => ({ idx: i, val: v }))
  return (
    <div style={{ width: '100%', height: 32 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line
            type="monotone"
            dataKey="val"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Analytical KPI Card with Delta & Sparkline ─────────────────────────────
function AnalyticalKpiCard({ title, value, delta, deltaLabel, sparkData, icon: Icon, color = COLOR_NORMAL, isRisk = false, onClick, active = false }) {
  const isPos = delta >= 0
  return (
    <div
      className={`kpi-card ${active ? 'active-kpi' : ''} ${onClick ? 'clickable-kpi' : ''}`}
      onClick={onClick}
    >
      <div className="kpi-top">
        <span className="kpi-title">{title}</span>
        {Icon && <Icon size={16} className="kpi-icon" style={{ color }} />}
      </div>
      <div className="kpi-main-val">{value}</div>
      <div className="kpi-meta-row">
        {delta !== undefined && delta !== null && (
          <span className={`kpi-delta-pill ${isRisk ? (delta > 0 ? 'delta-risk' : 'delta-good') : (isPos ? 'delta-good' : 'delta-risk')}`}>
            {isPos ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {isPos ? `+${delta}%` : `${delta}%`}
          </span>
        )}
        <span className="kpi-delta-label">{deltaLabel || 'vs prior period'}</span>
      </div>
      <div className="kpi-spark-wrap">
        <MiniSparkline data={sparkData} color={color} />
      </div>
    </div>
  )
}

export default function App() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [flash, setFlash] = useState(null)
  const [expandedRows, setExpandedRows] = useState(new Set())
  const fileInputRef = useRef(null)

  // ── Global Filter State ──────────────────────────────────────────────────
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [selectedVendor, setSelectedVendor] = useState('All')
  const [selectedCustomer, setSelectedCustomer] = useState('All')
  const [selectedFlag, setSelectedFlag] = useState('ALL') // ALL, NORMAL, DUPLICATE, ANOMALY, FLAGGED
  const [searchQuery, setSearchQuery] = useState('')
  const [dateRange, setDateRange] = useState('ALL') // ALL, 2026-01, 2026-02, 2026-03, 2026-04

  const loadData = () => {
    setLoading(true)
    fetch(`${API}/data`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(j => {
        setData(j)
        setError(null)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadData()
  }, [])

  const showFlash = (type, msg) => {
    setFlash({ type, msg })
    setTimeout(() => setFlash(null), 4000)
  }

  const handleUpload = async (e) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploading(true)
    const fd = new FormData()
    Array.from(files).forEach(f => fd.append('files', f))
    try {
      const res = await fetch(`${API}/upload`, { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Upload failed')
      showFlash('success', json.message || 'Files processed.')
      e.target.value = ''
      loadData()
    } catch (err) {
      showFlash('error', err.message)
    } finally {
      setUploading(false)
    }
  }

  const handleLoadDemo = async () => {
    setSeeding(true)
    try {
      const res = await fetch(`${API}/demo-data`, { method: 'POST' })
      const json = await res.json()
      showFlash('success', json.message || 'Loaded 30 sample invoices.')
      loadData()
    } catch (err) {
      showFlash('error', err.message)
    } finally {
      setSeeding(false)
    }
  }

  const handleClear = async () => {
    if (!window.confirm('Clear all invoices and pattern insights from database?')) return
    setClearing(true)
    try {
      await fetch(`${API}/clear`, { method: 'POST' })
      showFlash('success', 'Database cleared.')
      loadData()
    } catch (err) {
      showFlash('error', err.message)
    } finally {
      setClearing(false)
    }
  }

  const toggleRow = (id) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const resetAllFilters = () => {
    setSelectedCategory('All')
    setSelectedVendor('All')
    setSelectedCustomer('All')
    setSelectedFlag('ALL')
    setSearchQuery('')
    setDateRange('ALL')
  }

  // ── Client-side Filter Calculation ───────────────────────────────────────
  const rawInvoices = data?.invoices || []

  const filteredInvoices = useMemo(() => {
    return rawInvoices.filter(inv => {
      // Category filter
      if (selectedCategory !== 'All' && (inv.category || 'Other') !== selectedCategory) return false
      // Vendor filter
      if (selectedVendor !== 'All' && (inv.vendor || '') !== selectedVendor) return false
      // Customer filter
      if (selectedCustomer !== 'All' && (inv.customer || '') !== selectedCustomer) return false
      // Flag filter
      if (selectedFlag === 'NORMAL' && (inv.is_duplicate === 1 || inv.is_anomaly === 1)) return false
      if (selectedFlag === 'DUPLICATE' && inv.is_duplicate !== 1) return false
      if (selectedFlag === 'ANOMALY' && inv.is_anomaly !== 1) return false
      if (selectedFlag === 'FLAGGED' && (inv.is_duplicate !== 1 && inv.is_anomaly !== 1)) return false
      // Month range filter
      if (dateRange !== 'ALL' && inv.date && !inv.date.startsWith(dateRange)) return false
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchVen = (inv.vendor || '').toLowerCase().includes(q)
        const matchCust = (inv.customer || '').toLowerCase().includes(q)
        const matchInvId = (inv.invoice_id || '').toLowerCase().includes(q)
        const matchExp = (inv.xai_explanation || '').toLowerCase().includes(q)
        const matchItems = (inv.line_items || '').toLowerCase().includes(q)
        if (!matchVen && !matchCust && !matchInvId && !matchExp && !matchItems) return false
      }
      return true
    })
  }, [rawInvoices, selectedCategory, selectedVendor, selectedCustomer, selectedFlag, dateRange, searchQuery])

  // ── Derived Filtered Metrics ─────────────────────────────────────────────
  const filteredMetrics = useMemo(() => {
    const totalSpend = filteredInvoices.reduce((s, i) => s + (i.amount || 0), 0)
    const billCount = filteredInvoices.length
    const avgBill = billCount ? totalSpend / billCount : 0
    const totalTax = filteredInvoices.reduce((s, i) => s + (i.tax_amount || 0), 0)
    const dupCount = filteredInvoices.filter(i => i.is_duplicate === 1).length
    const dupAmount = filteredInvoices.filter(i => i.is_duplicate === 1).reduce((s, i) => s + (i.amount || 0), 0)
    const anomCount = filteredInvoices.filter(i => i.is_anomaly === 1).length
    const anomAmount = filteredInvoices.filter(i => i.is_anomaly === 1).reduce((s, i) => s + (i.amount || 0), 0)
    return { totalSpend, billCount, avgBill, totalTax, dupCount, dupAmount, anomCount, anomAmount }
  }, [filteredInvoices])

  // ── Dynamic Chart Data based on filtered slice ───────────────────────────
  const dynamicCategoryShare = useMemo(() => {
    const map = {}
    filteredInvoices.forEach(i => {
      const c = i.category || 'Other'
      map[c] = (map[c] || 0) + (i.amount || 0)
    })
    const total = Object.values(map).reduce((a, b) => a + b, 0)
    return Object.entries(map).map(([category, amt]) => ({
      category,
      total: Math.round(amt * 100) / 100,
      percentage: total ? Math.round((amt / total) * 1000) / 10 : 0
    })).sort((a, b) => b.total - a.total)
  }, [filteredInvoices])

  const dynamicTopVendors = useMemo(() => {
    const map = {}
    filteredInvoices.forEach(i => {
      const v = i.vendor || 'Unknown'
      map[v] = (map[v] || 0) + (i.amount || 0)
    })
    return Object.entries(map).map(([vendor, amt]) => ({
      vendor,
      total: Math.round(amt * 100) / 100,
      count: filteredInvoices.filter(x => x.vendor === vendor).length
    })).sort((a, b) => b.total - a.total).slice(0, 10)
  }, [filteredInvoices])

  const hasActiveFilters = selectedCategory !== 'All' || selectedVendor !== 'All' || selectedCustomer !== 'All' || selectedFlag !== 'ALL' || dateRange !== 'ALL' || searchQuery.trim().length > 0

  if (loading) {
    return (
      <div className="app-container loading-screen">
        <div className="spinner-large" />
        <h3 style={{ marginTop: 16 }}>Loading Spend Analytics Engine…</h3>
        <p style={{ color: 'var(--text-muted)' }}>Calculating variance, risk flags, and Document AI OCR extractions</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="app-container error-screen">
        <AlertTriangle size={48} color={COLOR_DUPLICATE} />
        <h2>Backend Connection Error</h2>
        <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>
          Could not communicate with Flask backend at <code>{API}</code>. Error: {error}
        </p>
        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={loadData}>
          <RefreshCw size={14} /> Retry Connection
        </button>
      </div>
    )
  }

  const kpis = data?.kpis || {}
  const charts = data?.charts || {}
  const sectionInsights = data?.section_insights || {}
  const insights = data?.insights || []
  const filterOptions = data?.filter_options || { categories: [], vendors: [], customers: [] }

  // ── Empty State ──────────────────────────────────────────────────────────
  if (rawInvoices.length === 0) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div>
            <div className="brand-badge">Analytical Spend Intelligence</div>
            <h1>Invoice Spend Analyzer</h1>
            <p className="header-subtitle">
              Structure spend as analytical questions · Item-level extraction via Document AI · Explanations with Gemini XAI
            </p>
          </div>
          <div className="header-actions">
            <button className="btn btn-primary" onClick={handleLoadDemo} disabled={seeding}>
              <Database size={15} /> {seeding ? 'Generating Invoices…' : 'Load 30-Invoice Sample Dataset'}
            </button>
            <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              <Upload size={15} /> {uploading ? 'Processing…' : 'Upload Invoices'}
            </button>
            <input ref={fileInputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif" onChange={handleUpload} style={{ display: 'none' }} />
          </div>
        </header>

        {flash && <div className={`flash-bar flash-${flash.type}`}>{flash.msg}</div>}

        <div className="empty-state-panel">
          <Database size={64} className="empty-icon-art" />
          <h2>No Invoice Data in System</h2>
          <p>
            Your invoice spend database is currently empty. You can either upload your real invoice documents or load our pre-configured analytical dataset to explore the dashboard.
          </p>
          <div className="empty-actions-row">
            <button className="btn btn-primary btn-lg" onClick={handleLoadDemo} disabled={seeding}>
              <Sparkles size={16} /> Load 30 Analytical Invoices with Outliers & Duplicates
            </button>
            <button className="btn btn-secondary btn-lg" onClick={() => fileInputRef.current?.click()}>
              <Upload size={16} /> Upload PDFs or Images
            </button>
          </div>
          <div className="empty-feature-grid">
            <div className="empty-feat">
              <ShieldCheck size={20} color={COLOR_NORMAL} />
              <div><strong>Item-Level Categorization</strong> — Strictly parses purchased products, completely ignoring vendor name bias.</div>
            </div>
            <div className="empty-feat">
              <AlertTriangle size={20} color={COLOR_DUPLICATE} />
              <div><strong>Automated Duplicate & Anomaly Audits</strong> — Catches double-payments and statistical variance spikes.</div>
            </div>
            <div className="empty-feat">
              <HelpCircle size={20} color={COLOR_ANOMALY} />
              <div><strong>Transparent XAI Insights</strong> — Explains impulsive buyer patterns citing specific invoice evidence.</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-container">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="app-header">
        <div>
          <div className="brand-badge">Financial Spend Audit & Intelligence</div>
          <h1>Invoice Spend Analyzer</h1>
          <p className="header-subtitle">
            Structured spend analysis · Grounded item-level classification · Mathematical XAI reasons
          </p>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary" onClick={handleLoadDemo} disabled={seeding} title="Reload 30 sample invoices">
            <Database size={14} /> {seeding ? 'Seeding…' : 'Reset Sample Data'}
          </button>
          <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            <Upload size={14} /> {uploading ? 'Processing…' : 'Upload Invoices'}
          </button>
          <button className="btn btn-danger-ghost" onClick={handleClear} disabled={clearing} title="Clear database">
            <Trash2 size={14} />
          </button>
          <input ref={fileInputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif" onChange={handleUpload} style={{ display: 'none' }} />
        </div>
      </header>

      {flash && <div className={`flash-bar flash-${flash.type}`}>{flash.msg}</div>}

      {/* ── Global Filter Bar ────────────────────────────────────────────── */}
      <div className="global-filter-bar">
        <div className="filter-item">
          <Filter size={14} className="filter-icon" />
          <span className="filter-label">Filters:</span>
        </div>

        {/* Date / Month Filter */}
        <div className="filter-select-wrap">
          <select value={dateRange} onChange={e => setDateRange(e.target.value)}>
            <option value="ALL">All Time</option>
            <option value="2026-01">Jan 2026</option>
            <option value="2026-02">Feb 2026</option>
            <option value="2026-03">Mar 2026</option>
            <option value="2026-04">Apr 2026</option>
          </select>
        </div>

        {/* Category Filter */}
        <div className="filter-select-wrap">
          <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}>
            <option value="All">All Categories</option>
            {filterOptions.categories.filter(c => c !== 'All').map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {/* Vendor Filter */}
        <div className="filter-select-wrap">
          <select value={selectedVendor} onChange={e => setSelectedVendor(e.target.value)}>
            <option value="All">All Vendors</option>
            {filterOptions.vendors.filter(v => v !== 'All').map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>

        {/* Customer Filter */}
        <div className="filter-select-wrap">
          <select value={selectedCustomer} onChange={e => setSelectedCustomer(e.target.value)}>
            <option value="All">All Customers</option>
            {filterOptions.customers.filter(cu => cu !== 'All').map(cu => (
              <option key={cu} value={cu}>{cu}</option>
            ))}
          </select>
        </div>

        {/* Flag Type Filter */}
        <div className="filter-select-wrap">
          <select value={selectedFlag} onChange={e => setSelectedFlag(e.target.value)}>
            <option value="ALL">All Invoices</option>
            <option value="NORMAL">Normal Invoices</option>
            <option value="DUPLICATE">Duplicates Only</option>
            <option value="ANOMALY">Anomalies Only</option>
            <option value="FLAGGED">All Flagged Risk</option>
          </select>
        </div>

        {/* Free Text Search */}
        <div className="filter-search-wrap">
          <Search size={14} className="search-icon" />
          <input
            type="text"
            placeholder="Search items, vendors, invoices…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="search-clear-btn" onClick={() => setSearchQuery('')}><X size={12} /></button>
          )}
        </div>

        {hasActiveFilters && (
          <button className="btn btn-sm btn-ghost reset-btn" onClick={resetAllFilters}>
            <X size={13} /> Reset Filters
          </button>
        )}
      </div>

      {hasActiveFilters && (
        <div className="filter-active-chips">
          <span className="chips-label">Active filters:</span>
          {selectedCategory !== 'All' && (
            <span className="filter-chip">Category: {selectedCategory} <X size={11} onClick={() => setSelectedCategory('All')} /></span>
          )}
          {selectedVendor !== 'All' && (
            <span className="filter-chip">Vendor: {selectedVendor} <X size={11} onClick={() => setSelectedVendor('All')} /></span>
          )}
          {selectedCustomer !== 'All' && (
            <span className="filter-chip">Customer: {selectedCustomer} <X size={11} onClick={() => setSelectedCustomer('All')} /></span>
          )}
          {selectedFlag !== 'ALL' && (
            <span className="filter-chip">Flag: {selectedFlag} <X size={11} onClick={() => setSelectedFlag('ALL')} /></span>
          )}
          {dateRange !== 'ALL' && (
            <span className="filter-chip">Period: {dateRange} <X size={11} onClick={() => setDateRange('ALL')} /></span>
          )}
          {searchQuery && (
            <span className="filter-chip">Search: "{searchQuery}" <X size={11} onClick={() => setSearchQuery('')} /></span>
          )}
          <span className="filter-slice-info">
            Showing <strong>{filteredInvoices.length}</strong> of {rawInvoices.length} invoices ({fmtCurr(filteredMetrics.totalSpend)})
          </span>
        </div>
      )}

      {/* ── SECTION 1: HOW MUCH ARE WE SPENDING OVERALL? ───────────────── */}
      <section className="analytical-section">
        <div className="section-header">
          <h2 className="section-title">Overview & Total Spend</h2>
        </div>

        <div className="kpi-grid">

          <AnalyticalKpiCard
            title="Total Spend"
            value={fmtCurr(hasActiveFilters ? filteredMetrics.totalSpend : kpis.total_spend, kpis.currency)}
            delta={kpis.spend_delta}
            deltaLabel="vs prior period"
            sparkData={kpis.spend_sparkline}
            icon={DollarSign}
            color={COLOR_NORMAL}
          />
          <AnalyticalKpiCard
            title="Bills Processed"
            value={hasActiveFilters ? filteredMetrics.billCount : kpis.bill_count}
            delta={kpis.count_delta}
            deltaLabel="volume delta"
            sparkData={kpis.count_sparkline}
            icon={Layers}
            color={COLOR_NORMAL}
          />
          <AnalyticalKpiCard
            title="Average Bill Value"
            value={fmtCurr(hasActiveFilters ? filteredMetrics.avgBill : kpis.avg_bill, kpis.currency)}
            delta={kpis.avg_delta}
            deltaLabel="ticket size delta"
            sparkData={kpis.avg_sparkline}
            icon={TrendingUp}
            color={COLOR_NORMAL}
          />
          <AnalyticalKpiCard
            title="Total Tax (VAT)"
            value={fmtCurr(hasActiveFilters ? filteredMetrics.totalTax : kpis.total_tax, kpis.currency)}
            delta={kpis.tax_delta}
            deltaLabel="tax compliance"
            sparkData={kpis.tax_sparkline}
            icon={PieIcon}
            color={COLOR_NORMAL}
          />
          <AnalyticalKpiCard
            title="Duplicates Flagged"
            value={hasActiveFilters ? filteredMetrics.dupCount : kpis.dup_count}
            delta={kpis.dup_count > 0 ? (kpis.dup_amount / Math.max(kpis.total_spend, 1) * 100).toFixed(1) : 0}
            deltaLabel={kpis.dup_count > 0 ? `${fmtCurr(hasActiveFilters ? filteredMetrics.dupAmount : kpis.dup_amount)} wasted` : '0 double-bills'}
            sparkData={[0, 0, 1, 1, 1, 2, kpis.dup_count]}
            icon={Copy}
            color={COLOR_DUPLICATE}
            isRisk={true}
            active={selectedFlag === 'DUPLICATE'}
            onClick={() => setSelectedFlag(prev => prev === 'DUPLICATE' ? 'ALL' : 'DUPLICATE')}
          />
          <AnalyticalKpiCard
            title="Anomalies Flagged"
            value={hasActiveFilters ? filteredMetrics.anomCount : kpis.anomaly_count}
            delta={kpis.anomaly_count > 0 ? (kpis.anomaly_amount / Math.max(kpis.total_spend, 1) * 100).toFixed(1) : 0}
            deltaLabel={kpis.anomaly_count > 0 ? `${fmtCurr(hasActiveFilters ? filteredMetrics.anomAmount : kpis.anomaly_amount)} outlier sum` : '0 price spikes'}
            sparkData={[0, 1, 1, 2, 2, 2, kpis.anomaly_count]}
            icon={AlertTriangle}
            color={COLOR_ANOMALY}
            isRisk={true}
            active={selectedFlag === 'ANOMALY'}
            onClick={() => setSelectedFlag(prev => prev === 'ANOMALY' ? 'ALL' : 'ANOMALY')}
          />
        </div>

        {/* Quality & Extraction Confidence Strip */}
        <div className="quality-trust-panel">
          <div className="quality-item">
            <ShieldCheck size={18} color={COLOR_NORMAL_ACCENT} />
            <div>
              <div className="quality-label">Extraction Accuracy (Document AI OCR)</div>
              <div className="quality-val">{kpis.avg_confidence}% Confidence Rating</div>
            </div>
          </div>
          <div className="quality-progress-wrap">
            <div className="quality-bar-track">
              <div className="quality-bar-fill" style={{ width: `${kpis.avg_confidence}%` }} />
            </div>
          </div>
          <div className="quality-item">
            <CheckCircle2 size={18} color={kpis.missing_fields_count === 0 ? COLOR_NORMAL_ACCENT : COLOR_ANOMALY} />
            <div>
              <div className="quality-label">Data Completeness</div>
              <div className="quality-val">{kpis.missing_fields_count === 0 ? 'Zero Missing Fields' : `${kpis.missing_fields_count} Invoices with Missing Fields`}</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 2: WHEN DOES SPENDING OCCUR? (TREND) ───────────────── */}
      <section className="analytical-section">
        <div className="section-header">
          <h2 className="section-title">Monthly Spend Trend</h2>
        </div>

        <div className="chart-card full-width-card">
          <div className="chart-header-row">
            <div>
              <div className="chart-title">Monthly Expenditure Trajectory</div>
              <div className="chart-subtitle">Total billing per calendar month with target baseline reference</div>
            </div>
            <div className="chart-legend-indicator">
              <span className="dot dot-blue" /> Actual Monthly Spend
              <span className="dot dot-gray" style={{ marginLeft: 16 }} /> Target Baseline
            </div>
          </div>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={charts.monthly_trend} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLOR_NORMAL} stopOpacity={0.30} />
                    <stop offset="95%" stopColor={COLOR_NORMAL} stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="month" stroke="#64748B" fontSize={12} tickLine={false} />
                <YAxis stroke="#64748B" fontSize={12} tickFormatter={v => `$${v}`} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(val, name) => [fmtCurr(val), name === 'total' ? 'Actual Spend' : 'Target Baseline']}
                  labelFormatter={lbl => `Billing Month: ${lbl}`}
                  contentStyle={{ backgroundColor: '#0F172A', color: '#F8FAFC', borderRadius: 6, border: 'none', fontSize: 12 }}
                />
                <ReferenceLine y={charts.monthly_trend?.[0]?.target || 1000} stroke="#94A3B8" strokeDasharray="4 4" label={{ value: 'Target Baseline', fill: '#64748B', fontSize: 11, position: 'insideTopRight' }} />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke={COLOR_NORMAL}
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#spendGradient)"
                  activeDot={{ r: 6, fill: COLOR_NORMAL, stroke: '#FFFFFF', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* ── SECTION 3: WHERE AND ON WHAT IS MONEY SPENT? ──────────────── */}
      <section className="analytical-section">
        <div className="section-header">
          <h2 className="section-title">Categories & Suppliers</h2>
        </div>


        <div className="two-chart-grid">
          {/* Chart 3A: Category Share Donut */}
          <div className="chart-card">
            <div className="chart-header-row">
              <div>
                <div className="chart-title">Spend by Category Share</div>
                <div className="chart-subtitle">Classified strictly by line item OCR descriptions (Click slice to filter)</div>
              </div>
            </div>
            <div style={{ width: '100%', height: 260, position: 'relative' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={dynamicCategoryShare}
                    dataKey="total"
                    nameKey="category"
                    cx="50%"
                    cy="50%"
                    innerRadius={65}
                    outerRadius={95}
                    paddingAngle={3}
                    onClick={entry => setSelectedCategory(prev => prev === entry.category ? 'All' : entry.category)}
                    cursor="pointer"
                  >
                    {dynamicCategoryShare.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={selectedCategory === entry.category ? '#1D4ED8' : CATEGORY_PALETTE[index % CATEGORY_PALETTE.length]}
                        stroke={selectedCategory === entry.category ? '#0F172A' : '#FFFFFF'}
                        strokeWidth={selectedCategory === entry.category ? 3 : 1.5}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(val, name, props) => [`${fmtCurr(val)} (${props.payload.percentage}%)`, name]}
                    contentStyle={{ backgroundColor: '#0F172A', color: '#F8FAFC', borderRadius: 6, border: 'none', fontSize: 12 }}
                  />
                  <Legend
                    layout="horizontal"
                    verticalAlign="bottom"
                    align="center"
                    iconType="circle"
                    formatter={val => <span style={{ fontSize: 11, color: '#475569' }}>{val}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 3B: Top 10 Vendors Horizontal Bar */}
          <div className="chart-card">
            <div className="chart-header-row">
              <div>
                <div className="chart-title">Top 10 Suppliers by Spend</div>
                <div className="chart-subtitle">Cumulative invoice billing per supplier (Click bar to drill)</div>
              </div>
            </div>
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={dynamicTopVendors}
                  margin={{ top: 5, right: 30, left: 30, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                  <XAxis type="number" stroke="#64748B" fontSize={11} tickFormatter={v => `$${v}`} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="vendor" stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} width={110} />
                  <Tooltip
                    formatter={(val) => [fmtCurr(val), 'Total Spend']}
                    contentStyle={{ backgroundColor: '#0F172A', color: '#F8FAFC', borderRadius: 6, border: 'none', fontSize: 12 }}
                  />
                  <Bar
                    dataKey="total"
                    fill={COLOR_NORMAL}
                    radius={[0, 4, 4, 0]}
                    cursor="pointer"
                    onClick={entry => setSelectedVendor(prev => prev === entry.vendor ? 'All' : entry.vendor)}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Lower Row: Category Mix by Month Stacked & Amount Histogram */}
        <div className="two-chart-grid" style={{ marginTop: 16 }}>
          {/* Stacked Category Mix */}
          <div className="chart-card">
            <div className="chart-header-row">
              <div>
                <div className="chart-title">Category Spending Mix by Month</div>
                <div className="chart-subtitle">How product category distributions evolve over time</div>
              </div>
            </div>
            <div style={{ width: '100%', height: 230 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.category_by_month} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis dataKey="month" stroke="#64748B" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748B" fontSize={11} tickFormatter={v => `$${v}`} tickLine={false} axisLine={false} />
                  <Tooltip
                    formatter={(v, name) => [fmtCurr(v), name]}
                    contentStyle={{ backgroundColor: '#0F172A', color: '#F8FAFC', borderRadius: 6, border: 'none', fontSize: 12 }}
                  />
                  {dynamicCategoryShare.map((cat, idx) => (
                    <Bar
                      key={cat.category}
                      dataKey={cat.category}
                      stackId="a"
                      fill={CATEGORY_PALETTE[idx % CATEGORY_PALETTE.length]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Amount Distribution Histogram */}
          <div className="chart-card">
            <div className="chart-header-row">
              <div>
                <div className="chart-title">Bill Size Distribution (Ticket Sizing)</div>
                <div className="chart-subtitle">Frequency count of invoices across amount tiers</div>
              </div>
            </div>
            <div style={{ width: '100%', height: 230 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.amount_distribution} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis dataKey="range" stroke="#64748B" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748B" fontSize={11} allowDecimals={false} tickLine={false} axisLine={false} />
                  <Tooltip
                    formatter={(v, name, p) => [`${v} invoices (${p.payload.percentage}%)`, 'Volume']}
                    contentStyle={{ backgroundColor: '#0F172A', color: '#F8FAFC', borderRadius: 6, border: 'none', fontSize: 12 }}
                  />
                  <Bar dataKey="count" fill="#475569" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 4: RISK FLAGS (ANOMALIES & DUPLICATES) ── */}
      <section className="analytical-section">
        <div className="section-header">
          <h2 className="section-title">Risk Flags: Duplicates & Anomalies</h2>
        </div>

        <div className="chart-card full-width-card">
          <div className="chart-header-row">
            <div>
              <div className="chart-title">Outlier & Anomaly Scatter Map (Amount vs Date)</div>
              <div className="chart-subtitle">Identifies price shocks and suspicious duplicates against baseline threshold</div>
            </div>
            <div className="chart-legend-indicator">
              <span className="dot dot-blue" /> Normal Bill
              <span className="dot dot-amber" style={{ marginLeft: 14 }} /> Duplicate (Double-bill)
              <span className="dot dot-red" style={{ marginLeft: 14 }} /> Outlier Anomaly (&gt;2.5x vendor avg)
            </div>
          </div>
          <div style={{ width: '100%', height: 270 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 15, right: 24, left: 0, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="date" stroke="#64748B" fontSize={11} tickLine={false} />
                <YAxis dataKey="amount" stroke="#64748B" fontSize={11} tickFormatter={v => `$${v}`} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ payload }) => {
                    if (!payload || !payload.length) return null
                    const pt = payload[0].payload
                    return (
                      <div className="scatter-tooltip">
                        <div className="sc-top">
                          <strong>{pt.vendor}</strong> — {pt.invoice_id}
                        </div>
                        <div className="sc-row">Date: {pt.date} · Amount: <strong>${pt.amount?.toFixed(2)}</strong></div>
                        <div className="sc-row">Category: {pt.category}</div>
                        {pt.is_duplicate === 1 && (
                          <div className="sc-flag sc-dup">
                            <Copy size={12} /> DUPLICATE: {pt.reason}
                          </div>
                        )}
                        {pt.is_anomaly === 1 && (
                          <div className="sc-flag sc-anom">
                            <AlertTriangle size={12} /> ANOMALY: {pt.reason}
                          </div>
                        )}
                      </div>
                    )
                  }}
                />
                <ReferenceLine y={250} stroke="#EF4444" strokeDasharray="3 3" label={{ value: 'Audit Threshold ($250)', fill: '#EF4444', fontSize: 11, position: 'insideTopLeft' }} />
                <Scatter
                  data={charts.anomaly_scatter}
                  onClick={entry => {
                    setSearchQuery(entry.invoice_id)
                    toggleRow(entry.id)
                  }}
                  cursor="pointer"
                >
                  {charts.anomaly_scatter?.map((entry, index) => {
                    let fill = COLOR_NORMAL
                    if (entry.is_anomaly === 1) fill = COLOR_DUPLICATE
                    else if (entry.is_duplicate === 1) fill = COLOR_ANOMALY
                    return (
                      <Cell
                        key={`scatter-${index}`}
                        fill={fill}
                        stroke={entry.is_anomaly || entry.is_duplicate ? '#0F172A' : '#FFFFFF'}
                        strokeWidth={entry.is_anomaly ? 2 : 1}
                        r={entry.is_anomaly ? 8 : (entry.is_duplicate ? 7 : 5)}
                      />
                    )
                  })}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* ── SECTION 5: AI SPENDING INSIGHTS & EXPLANATIONS (XAI) ────────── */}
      <section className="analytical-section">
        <div className="section-header">
          <h2 className="section-title">AI Spending Insights & Explanations</h2>
        </div>

        <div className="xai-cards-grid">
          {insights.map((item, idx) => {
            const severity = (item?.severity || 'info').toString().toLowerCase()
            const title = item?.title || 'Spend Insight'
            const finding = item?.insight || item?.finding || ''
            const isDanger = severity === 'danger'
            const isWarn = severity === 'warning'
            const borderCol = isDanger ? COLOR_DUPLICATE : isWarn ? COLOR_ANOMALY : COLOR_NORMAL
            return (
              <div key={idx} className="xai-card" style={{ borderLeftColor: borderCol }}>
                <div className="xai-card-header">
                  <div className="xai-header-left">
                    {isDanger ? <AlertCircle size={17} color={COLOR_DUPLICATE} /> : isWarn ? <Zap size={17} color={COLOR_ANOMALY} /> : <Info size={17} color={COLOR_NORMAL} />}
                    <h3 className="xai-title">{title}</h3>
                  </div>
                  <span className={`xai-sev-badge ${isDanger ? 'sev-danger' : isWarn ? 'sev-warning' : 'sev-info'}`}>
                    {severity.toUpperCase()}
                  </span>
                </div>

                <div className="xai-finding">
                  <strong>Finding:</strong> {finding}
                </div>

                {item.reason && (
                  <div className="xai-reason-box">
                    <span className="xai-sec-label">Mathematical & Procedural Reason:</span>
                    <p>{item.reason}</p>
                  </div>
                )}

                {item.evidence && (
                  <div className="xai-evidence-box">
                    <span className="xai-sec-label">Documented Evidence & Source Invoices:</span>
                    <p>{item.evidence}</p>
                    {item.source_transactions && item.source_transactions.length > 0 && (
                      <div className="xai-sources-row">
                        <span>Click to inspect citation:</span>
                        {item.source_transactions.map(invId => (
                          <button
                            key={invId}
                            className="source-chip-btn"
                            onClick={() => {
                              setSearchQuery(invId)
                              const targetInv = rawInvoices.find(x => x.invoice_id === invId)
                              if (targetInv) toggleRow(targetInv.id)
                            }}
                          >
                            {invId} <ArrowUpRight size={11} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* ── SECTION 6: INVOICES & ITEMIZED DETAILS ──────────── */}
      <section className="analytical-section">
        <div className="section-header">
          <h2 className="section-title">Invoice Details</h2>
        </div>

        <div className="table-card">
          <div className="table-meta-bar">
            <span>Showing <strong>{filteredInvoices.length}</strong> of {rawInvoices.length} invoices</span>
            <span className="table-hint">Click any row to expand itemized line items and OCR confidence audit</span>
          </div>

          <div className="table-responsive">
            <table className="analytical-table">
              <thead>
                <tr>
                  <th style={{ width: 30 }} />
                  <th>Invoice No</th>
                  <th>Date</th>
                  <th>Vendor</th>
                  <th>Customer</th>
                  <th>Items Summary</th>
                  <th style={{ textAlign: 'right' }}>Net</th>
                  <th style={{ textAlign: 'right' }}>Tax</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th>Category</th>
                  <th>Flag</th>
                  <th>Audit Reason</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map(inv => {
                  const isExpanded = expandedRows.has(inv.id)
                  const lineItems = parseItemsArray(inv.line_items)
                  const itemsPreview = lineItems.map(it => it.description || it).slice(0, 2).join(', ')

                  return (
                    <React.Fragment key={inv.id}>
                      <tr
                        className={`table-row ${inv.is_duplicate ? 'row-dup-bg' : inv.is_anomaly ? 'row-anom-bg' : ''} ${isExpanded ? 'row-expanded' : ''}`}
                        onClick={() => toggleRow(inv.id)}
                      >
                        <td className="expand-chevron-cell">
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </td>
                        <td className="code-font font-bold">{inv.invoice_id}</td>
                        <td className="text-nowrap">{fmtDate(inv.date)}</td>
                        <td><strong>{inv.vendor}</strong></td>
                        <td className="customer-cell">{inv.customer || 'Acme Corp'}</td>
                        <td className="items-preview-cell" title={itemsPreview}>{itemsPreview || 'General Order'}</td>
                        <td className="amount-col">{fmtCurr(inv.net_amount, inv.currency)}</td>
                        <td className="amount-col">{fmtCurr(inv.tax_amount, inv.currency)}</td>
                        <td className="amount-col font-bold">{fmtCurr(inv.amount, inv.currency)}</td>
                        <td>
                          <span
                            className="cat-pill clickable-pill"
                            onClick={e => {
                              e.stopPropagation()
                              setSelectedCategory(inv.category)
                            }}
                          >
                            {inv.category || 'Other'}
                          </span>
                        </td>
                        <td>
                          {inv.is_duplicate === 1 ? (
                            <span className="flag-badge flag-duplicate">
                              <Copy size={10} /> Duplicate
                            </span>
                          ) : inv.is_anomaly === 1 ? (
                            <span className="flag-badge flag-anomaly">
                              <AlertTriangle size={10} /> Anomaly
                            </span>
                          ) : (
                            <span className="flag-badge flag-normal">Normal</span>
                          )}
                        </td>
                        <td className="reason-cell">
                          {inv.xai_explanation ? (
                            <span className={inv.is_duplicate ? 'reason-text-dup' : inv.is_anomaly ? 'reason-text-anom' : 'reason-text-norm'}>
                              {inv.xai_explanation}
                            </span>
                          ) : '—'}
                        </td>
                      </tr>

                      {/* ── Expanded Row: Detailed Line Items & OCR Audit Trail ── */}
                      {isExpanded && (
                        <tr className="expanded-detail-row">
                          <td colSpan={12} className="expanded-detail-cell">
                            <div className="expanded-box">
                              <div className="expanded-header">
                                <div className="exp-title-row">
                                  <strong>Invoice {inv.invoice_id} Details</strong>
                                  <span className="exp-sub">Source File: <code>{inv.source_file}</code></span>
                                  <span className="confidence-tag">
                                    <ShieldCheck size={13} color={COLOR_NORMAL_ACCENT} />
                                    OCR Confidence: {Math.round((inv.confidence || 0.95) * 100)}%
                                  </span>
                                </div>
                              </div>

                              {/* Itemized Line Items Table */}
                              <div className="expanded-table-wrap">
                                <div className="exp-table-label">Itemized Purchased Products (Line Items)</div>
                                {lineItems.length > 0 ? (
                                  <table className="line-items-subtable">
                                    <thead>
                                      <tr>
                                        <th>Description</th>
                                        <th>Item Category</th>
                                        <th style={{ textAlign: 'right' }}>Qty</th>
                                        <th style={{ textAlign: 'right' }}>Unit Price</th>
                                        <th style={{ textAlign: 'right' }}>Line Total</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {lineItems.map((item, idx) => (
                                        <tr key={idx}>
                                          <td><strong>{item.description || item}</strong></td>
                                          <td>
                                            <span className="cat-pill-sm">{item.category || inv.category || 'Other'}</span>
                                          </td>
                                          <td style={{ textAlign: 'right' }}>{item.qty || 1}</td>
                                          <td style={{ textAlign: 'right' }}>{fmtCurr(item.unit_price, inv.currency)}</td>
                                          <td style={{ textAlign: 'right' }} className="font-bold">{fmtCurr(item.line_total || item.unit_price, inv.currency)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                ) : (
                                  <div className="subtable-empty">No itemized line items extracted from this invoice.</div>
                                )}
                              </div>

                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  )
}
