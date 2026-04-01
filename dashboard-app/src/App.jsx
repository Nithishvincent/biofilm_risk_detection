import { useState, useEffect, useMemo } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  RadialLinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Line, Radar, Bar } from 'react-chartjs-2'

import {
  Microscope,
  Shield,
  Activity,
  Droplet,
  Thermometer,
  Wind,
  Cloud,
  Zap,
  AlertTriangle,
  Check,
  Settings,
  FlaskConical,
  Wifi,
  WifiOff,
  ClipboardList
} from './components/Icons'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { Analytics } from '@vercel/analytics/react'
import './App.css'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  RadialLinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
)

const API_URL = 'https://api.thingspeak.com/channels/692657/feeds.json?results=10'

const CHEMICALS = {
  chlorine: { name: 'Sodium Hypochlorite (12.5%)', unit: 'ml', rate: 50 }, // 50ml/1000L for shock
  phPlus: { name: 'pH Plus (Sodium Carbonate)', unit: 'g', rate: 50 }, // 50g/1000L
  phMinus: { name: 'pH Minus (Sodium Bisulfate)', unit: 'g', rate: 50 } // 50g/1000L
}

function predictBiofilmRisk(temp, ph, turbidity, flow, tds) {
  // Simple heuristic model for demo purposes
  // Real model would be ML-based trained on historical data
  let score = 10 // Base risk

  // Temp factor (ideal for biofilm: 20-35C)
  if (temp > 20 && temp < 35) score += 20
  else if (temp > 35) score += 10

  // pH factor (extreme pH inhibits growth, neutral promotes)
  if (ph > 6.5 && ph < 8.0) score += 20

  // Turbidity factor (suspended particles provide surface area)
  if (turbidity > 5) score += 25

  // Stagnation factor (low flow promotes attachment)
  // YF-S201 sensor outputs L/min; < 1 L/min indicates stagnation
  if (flow < 1) score += 25
  else if (flow < 3) score += 15

  // Nutrients/TDS
  if (tds > 500) score += 10

  return Math.min(score, 100)
}

function dssLogic(risk, ph, turbidity) {
  if (risk > 80) return "Critical: Immediate chemical shock required."
  if (risk > 60) return "Warning: Increase flow rate and monitor."
  if (ph < 6.5 || ph > 8.5) return "Action: Adjust pH levels."
  if (turbidity > 10) return "Action: Check filtration system."
  return "Normal Operation"
}

function calculateTreatments(vol, risk, dss, ph) {
  const list = []
  // Disinfection Logic: High risk or DSS recommendation
  if (risk >= 60 || dss !== 'Normal Operation') {
    const amount = (vol / 1000) * CHEMICALS.chlorine.rate
    list.push({ ...CHEMICALS.chlorine, amount: Math.ceil(amount), reason: 'Biofilm risk / Preventive maintenance' })
  }

  // pH Logic
  if (ph !== '--') {
    const p = Number(ph)
    if (p < 6.5) {
      const amount = (vol / 1000) * CHEMICALS.phPlus.rate
      list.push({ ...CHEMICALS.phPlus, amount: Math.ceil(amount), reason: 'Low pH (< 6.5)' })
    } else if (p > 8.5) {
      const amount = (vol / 1000) * CHEMICALS.phMinus.rate
      list.push({ ...CHEMICALS.phMinus, amount: Math.ceil(amount), reason: 'High pH (> 8.5)' })
    }
  }
  return list
}

// Helper to determine biofilm stage
const getBiofilmStage = (risk) => {
  if (risk < 30) return { stage: 'Initial Attachment', color: 'green', desc: 'Planktonic cells attaching.' }
  if (risk < 60) return { stage: 'Irreversible Attachment', color: 'orange', desc: 'EPS production starting.' }
  if (risk < 85) return { stage: 'Maturation I', color: 'orange', desc: 'Microcolonies forming.' }
  return { stage: 'Maturation II / Dispersion', color: 'red', desc: 'Critical mass reached.' }
}

// NEW: Comprehensive Solution Plan Generator
function getSolutionPlan(ph, temp, turb, tds, riskScore, waterVolume, daysSince, flow) {
  const solutions = []

  // Chemical Treatment - Low pH
  // Industry rate: ~17g soda ash per 0.1 pH-point raise per 1000L
  if (ph !== '--' && Number(ph) < 6.5) {
    const phDelta = 6.5 - Number(ph)
    const dosage = (phDelta * (waterVolume / 1000) * 170).toFixed(0)
    solutions.push({
      id: 'ph-low',
      category: 'Chemical Treatment',
      issue: `Low pH (${ph})`,
      priority: 'Critical',
      action: 'Add pH Increaser',
      chemical: 'Soda Ash (Sodium Carbonate)',
      dosage: `${dosage} g`,
      timeline: 'Immediate',
      steps: [
        'Test current pH with calibrated meter',
        `Dissolve ${dosage}g sodium carbonate in a bucket of water`,
        'Add slowly while circulating system',
        'Wait 4 hours for complete mixing',
        'Retest pH level',
        'Repeat with half-dose if pH is still below 6.5',
        'Monitor for 24 hours'
      ],
      safety: 'Wear gloves and eye protection. Avoid inhaling dust.',
      frequency: 'As needed based on testing'
    })
  }

  // Chemical Treatment - High pH
  // Industry rate: ~25g sodium bisulfate per 0.1 pH-point drop per 1000L
  if (ph !== '--' && Number(ph) > 8.5) {
    const phDelta = Number(ph) - 8.5
    const dosage = (phDelta * (waterVolume / 1000) * 250).toFixed(0)
    solutions.push({
      id: 'ph-high',
      category: 'Chemical Treatment',
      issue: `High pH (${ph})`,
      priority: 'Critical',
      action: 'Add pH Decreaser',
      chemical: 'Sodium Bisulfate',
      dosage: `${dosage} g`,
      timeline: 'Immediate',
      steps: [
        'Test current pH level with calibrated meter',
        `Dissolve ${dosage}g sodium bisulfate in a bucket of water`,
        'Add slowly to system with circulation running',
        'Wait 6 hours for equilibration',
        'Retest pH and adjust if needed',
        'Repeat with half-dose if pH is still above 8.5',
        'Monitor for 24 hours'
      ],
      safety: 'CAUTION: Acidic compound. Wear gloves, goggles, and protective clothing.',
      frequency: 'As needed'
    })
  }

  // Turbidity Treatment
  // Industry rate: 5–50 mg/L alum depending on turbidity; using 30g per 1000L as moderate dose
  if (turb !== '--' && Number(turb) > 5) {
    const dosage = ((waterVolume / 1000) * 30).toFixed(0)
    solutions.push({
      id: 'turbidity',
      category: 'Physical Cleaning',
      issue: `High Turbidity (${turb} NTU)`,
      priority: 'High',
      action: 'Clarification Treatment',
      chemical: 'Aluminum Sulfate (Alum)',
      dosage: `${dosage} g`,
      timeline: 'Within 12 hours',
      steps: [
        'Stop circulation temporarily',
        `Pre-dissolve ${dosage}g alum in a bucket of water`,
        'Pour slowly into the system',
        'Mix gently for 5 minutes',
        'Allow settling for 2–3 hours',
        'Filter or vacuum settled solids',
        'Backwash filters',
        'Resume circulation and retest turbidity'
      ],
      safety: 'Avoid inhalation of powder. Wear dust mask.',
      frequency: 'Weekly if turbidity persists'
    })
  }

  // Maintenance Schedule
  const days = parseInt(daysSince?.split(' ')[0] || '0')
  if (days > 14) {
    solutions.push({
      id: 'maintenance',
      category: 'Preventive Maintenance',
      issue: `Overdue Maintenance (${daysSince})`,
      priority: days > 30 ? 'Critical' : 'High',
      action: 'Complete System Cleaning',
      chemical: 'N/A',
      dosage: 'Full cleaning protocol',
      timeline: days > 30 ? 'Immediate' : 'Within 24hrs',
      steps: [
        'Shut down system safely',
        'Drain to appropriate level',
        'Scrub all surfaces',
        'Remove biofilm deposits',
        'Inspect pipes and sensors',
        'Sanitize with chlorine (100 ppm, 2hrs)',
        'Rinse thoroughly',
        'Restart and log maintenance'
      ],
      safety: 'Use PPE, ensure ventilation',
      frequency: 'Every 14 days minimum'
    })
  }

  // Shock Chlorination for High Risk
  // Industry rate: ~8g calcium hypochlorite per 1000L for shock dosing (achieves ~50 ppm)
  if (riskScore > 60) {
    const dosage = ((waterVolume / 1000) * 8).toFixed(0)
    solutions.push({
      id: 'chlorination',
      category: 'Disinfection',
      issue: `High Biofilm Risk (${riskScore.toFixed(1)}%)`,
      priority: 'Critical',
      action: 'Shock Chlorination',
      chemical: 'Calcium Hypochlorite (65–70%)',
      dosage: `${dosage} g (~50 ppm)`,
      timeline: 'Immediate',
      steps: [
        `Pre-dissolve ${dosage}g calcium hypochlorite in a bucket of water`,
        'Add solution during off-peak hours',
        'Circulate for even distribution',
        'Maintain 50–100 ppm free chlorine for 4–6 hours',
        'Test free chlorine levels hourly',
        'Allow residual to drop to 1–3 ppm before normal use',
        'Monitor biofilm risk daily for 1 week'
      ],
      safety: 'TOXIC. Use only in ventilated areas. Wear gloves, goggles, and respirator. Never mix with acids.',
      frequency: 'Monthly or when risk >60%'
    })
  }

  // Enhanced Monitoring
  if (riskScore > 40) {
    solutions.push({
      id: 'monitoring',
      category: 'Enhanced Monitoring',
      issue: `Elevated Risk (${riskScore.toFixed(1)}%)`,
      priority: 'Medium',
      action: 'Increase Testing Frequency',
      chemical: 'N/A',
      dosage: 'N/A',
      timeline: 'Ongoing',
      steps: [
        'Test every 2 hours',
        'Log all readings',
        'Plot daily trends',
        'Set deviation alerts',
        'Adjust treatment promptly',
        'Continue until risk <30% for 48hrs'
      ],
      safety: 'N/A',
      frequency: 'Until risk normalizes'
    })
  }

  // Temperature Control
  if (temp !== '--' && Number(temp) > 30) {
    solutions.push({
      id: 'cooling',
      category: 'System Modification',
      issue: `High Temperature (${temp}°C)`,
      priority: Number(temp) > 35 ? 'High' : 'Medium',
      action: 'Implement Cooling',
      chemical: 'N/A',
      dosage: 'N/A',
      timeline: Number(temp) > 35 ? 'Within 24hrs' : 'Within 1 week',
      steps: [
        'Identify heat source (sun exposure, nearby equipment, etc.)',
        'Install shade structures, pipe insulation, or active chiller',
        'For immediate relief: partially drain and add cool water',
        'Monitor water temperature during peak heat hours',
        'Target water temperature below 28°C'
      ],
      safety: 'Avoid rapid temperature changes (>2°C/hr) to prevent thermal shock',
      frequency: 'Seasonal adjustment'
    })
  }

  // Low Flow / Stagnation — primary biofilm risk factor
  // YF-S201 sensor outputs L/min; < 1 L/min indicates near-stagnation
  if (flow !== '--' && Number(flow) < 1) {
    solutions.push({
      id: 'stagnation',
      category: 'System Modification',
      issue: `Low Flow Rate (${flow} L/min)`,
      priority: Number(flow) < 0.2 ? 'Critical' : 'High',
      action: 'Restore Water Circulation',
      chemical: 'N/A',
      dosage: 'N/A',
      timeline: 'Immediate',
      steps: [
        'Verify flow sensor is reading correctly (check for air bubbles or debris)',
        'Check pump operation — restart if needed',
        'Inspect pipes for blockages, kinks, or closed valves',
        'Open all valves and dead-leg sections to eliminate stagnant zones',
        'Flush dead-legs with fresh water for 5–10 minutes',
        'Verify flow rate returns above 1 L/min',
        'If stagnation persists, consider installing a circulation pump'
      ],
      safety: 'Stagnant water may harbor harmful bacteria. Use PPE when handling.',
      frequency: 'Check daily — stagnation is the #1 biofilm risk factor'
    })
  }

  return solutions
}


export default function App() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [feeds, setFeeds] = useState([])
  const [lastUpdate, setLastUpdate] = useState(null)
  const [isSimulated, setIsSimulated] = useState(false)
  const [showSimulatedData, setShowSimulatedData] = useState(false)

  const [waterVolume, setWaterVolume] = useState(() => Number(localStorage.getItem('waterVolume')) || 1000)
  const [lastMaintenance, setLastMaintenance] = useState(() => localStorage.getItem('lastMaintenance') || null)
  const [showSettings, setShowSettings] = useState(false)
  const [offsets, setOffsets] = useState(() => {
    const saved = localStorage.getItem('calibOffsets')
    return saved ? JSON.parse(saved) : { ph: 0, temp: 0, tds: 0 }
  })

  // Maintenance Log — persistent array of entries
  const [maintenanceLog, setMaintenanceLog] = useState(() => {
    try {
      const saved = localStorage.getItem('maintenanceLog')
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })
  const [showAddMaintenance, setShowAddMaintenance] = useState(false)
  const [maintType, setMaintType] = useState('Cleaning')
  const [maintNotes, setMaintNotes] = useState('')

  // Per-sensor enable/disable (flow defaults OFF — sensor isolated, saved for deployment)
  const [sensorEnabled, setSensorEnabled] = useState(() => {
    const saved = localStorage.getItem('sensorEnabled')
    return saved ? JSON.parse(saved) : { ph: true, temp: true, humidity: true, flow: false, turb: true, tds: true }
  })

  const toggleSensor = (key) => {
    setSensorEnabled(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const [theme, setTheme] = useState('light')
  const [connectionStatus, setConnectionStatus] = useState('connecting') // connected, disconnected, connecting

  useEffect(() => {
    localStorage.setItem('waterVolume', waterVolume)
  }, [waterVolume])

  useEffect(() => {
    if (lastMaintenance) {
      localStorage.setItem('lastMaintenance', lastMaintenance)
    } else {
      localStorage.removeItem('lastMaintenance')
    }
  }, [lastMaintenance])

  useEffect(() => {
    localStorage.setItem('maintenanceLog', JSON.stringify(maintenanceLog))
  }, [maintenanceLog])

  // Add a maintenance log entry
  const addMaintenanceEntry = (type = 'Cleaning', notes = '') => {
    const entry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      type,
      notes,
      sensorSnapshot: {
        ph: ph !== '--' ? Number(ph) : null,
        temp: temp !== '--' ? Number(temp) : null,
        turb: turb !== '--' ? Number(turb) : null,
        tds: tds !== '--' ? Number(tds) : null,
        flow: flow !== '--' ? Number(flow) : null,
        risk: riskScore
      }
    }
    setMaintenanceLog(prev => [entry, ...prev])
    setLastMaintenance(new Date().toISOString())
    return entry
  }

  const clearMaintenanceLog = () => {
    if (confirm('Clear all maintenance log entries?')) {
      setMaintenanceLog([])
    }
  }

  useEffect(() => {
    localStorage.setItem('calibOffsets', JSON.stringify(offsets))
  }, [offsets])

  useEffect(() => {
    localStorage.setItem('sensorEnabled', JSON.stringify(sensorEnabled))
  }, [sensorEnabled])

  // Apply theme to body
  useEffect(() => {
    document.body.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission()
    }
  }, [])

  // Lock body scroll when settings modal is open
  useEffect(() => {
    if (showSettings) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [showSettings])

  const fetchData = async () => {
    try {
      // setLoading(true) // Don't block UI on background updates
      const res = await fetch(API_URL)
      const json = await res.json()
      if (json.feeds && json.feeds.length > 0) {
        const latest = json.feeds[json.feeds.length - 1]
        setData(latest)
        setFeeds(json.feeds)
        setLastUpdate(new Date().toLocaleTimeString())

        // Check if data is stale (> 45 seconds — test.py uploads every 16s)
        const lastTime = new Date(latest.created_at).getTime()
        const now = Date.now()
        const isStale = (now - lastTime) > 45000

        // Check Status Code (Field 8) and Staleness
        // negative = Simulated Data
        // 0 = Manual Shutdown
        const rawStatusCode = Number(latest.field8)
        const isSimData = rawStatusCode < 0
        setIsSimulated(isSimData)

        const statusCode = Math.abs(rawStatusCode)

        if (statusCode === 0 || isStale) {
          setConnectionStatus('disconnected') // Consolidate to "Offline"
        } else if (isSimData) {
          setConnectionStatus('simulated') // Simulated Mode
        } else {
          setConnectionStatus('connected') // Active
        }
      }
    } catch (err) {
      console.error("Error fetching data:", err)
      setConnectionStatus('disconnected')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000) // Poll every 5s
    return () => clearInterval(interval)
  }, [])

  const shouldShowData = !isSimulated || showSimulatedData

  // Derived Values — returns '--' if sensor is disabled
  const getVal = (field, offsetKey = null, sensorKey = null) => {
    if (!shouldShowData) return '--'
    if (sensorKey && !sensorEnabled[sensorKey]) return '--'
    if (!data || !data[field]) return '--'
    let val = parseFloat(data[field])
    if (offsetKey) val += (offsets[offsetKey] || 0)
    return isNaN(val) ? '--' : val.toFixed(1)
  }

  const ph = getVal('field1', 'ph', 'ph') // pH
  const temp = getVal('field2', 'temp', 'temp') // Temp
  const humidity = getVal('field3', null, 'humidity') // Humidity
  const flow = getVal('field4', null, 'flow') // Flow (isolated — off by default)
  const turb = getVal('field5', null, 'turb') // Turbidity
  const tds = getVal('field6', 'tds', 'tds') // TDS

  // Calculate Risk
  // PRIORITIZE ML MODEL from Backend (Field 7)
  // If Field 7 is present, use it. Otherwise fallback to frontend heuristic.
  // Disabled sensors pass a 'neutral' value so they don't inflate risk.
  const rawRisk = shouldShowData && data && data.field7 ? Number(data.field7) : null

  const riskScore = (rawRisk !== null)
    ? rawRisk
    : (ph !== '--' || temp !== '--' || turb !== '--' || tds !== '--') // at least some sensors active
      ? predictBiofilmRisk(
        temp !== '--' ? Number(temp) : 25,    // neutral temp if disabled
        ph !== '--' ? Number(ph) : 7.0,       // neutral pH if disabled
        turb !== '--' ? Number(turb) : 0,     // best-case turbidity if disabled
        flow !== '--' ? Number(flow) : 100,   // best-case flow if disabled (avoids false low-flow penalty)
        tds !== '--' ? Number(tds) : 0        // best-case TDS if disabled
      )
      : 0

  const hasAnySensor = shouldShowData && (ph !== '--' || temp !== '--' || turb !== '--' || tds !== '--' || flow !== '--')
  const riskPercent = hasAnySensor ? Number(riskScore).toFixed(1) + '%' : '--%'

  // Detect if live ML model prediction is being used (field7 is populated by test.py)
  const isAiActive = !!(data && data.field7)
  const aiModelSource = isAiActive ? 'Hybrid Ensemble (RF + XGB + LSTM)' : 'Heuristic Fallback'

  // Docs panel state
  const [showDocs, setShowDocs] = useState(false)
  const [docsTab, setDocsTab] = useState('overview')


  useEffect(() => {
    const riskVal = riskScore
    if (riskVal > 80 && 'Notification' in window && Notification.permission === 'granted') {
      const lastAlert = localStorage.getItem('lastAlertTimestamp')
      const now = Date.now()
      if (!lastAlert || (now - Number(lastAlert) > 3600000)) {
        new Notification('⚠️ High Biofilm Risk Detected', {
          body: `Current Risk: ${riskVal}%. Immediate action required.`
        })
        localStorage.setItem('lastAlertTimestamp', now)
      }
    }
  }, [riskScore])

  // Auto-estimate volume from flow
  const estimateVolume = () => {
    if (flow !== '--') {
      // Heuristic: Flow (L/min) × 60 min = approximate system volume (1-hour turnover)
      const est = Math.round(Number(flow) * 60)
      setWaterVolume(est)
      alert(`Volume estimated at ${est} L based on current flow rate (1-hour turnover).`)
    } else {
      alert("Cannot estimate volume: Flow rate data unavailable.")
    }
  }

  // Badge Logic
  const getRiskBadge = (score) => {
    if (score < 30) return { text: 'Low Risk', className: 'badge low' }
    if (score < 60) return { text: 'Moderate Risk', className: 'badge medium' }
    return { text: 'High Risk', className: 'badge high' }
  }
  const riskBadge = getRiskBadge(riskScore)
  const biofilmStage = getBiofilmStage(riskScore)

  // System Health (Inverse of Risk for demo)
  const healthPct = hasAnySensor ? Number((100 - riskScore).toFixed(1)) : 0
  const healthColor = healthPct > 70 ? 'var(--success-gradient)' : healthPct > 40 ? 'var(--warning-gradient)' : 'var(--danger-gradient)'

  // Contributing Factors — only include enabled sensors
  const contributingFactors = []
  if (data) {
    if (sensorEnabled.temp && temp !== '--' && Number(temp) > 30) contributingFactors.push('High Temp')
    if (sensorEnabled.flow && flow !== '--' && Number(flow) < 1) contributingFactors.push('Low Flow / Stagnation')
    if (sensorEnabled.turb && turb !== '--' && Number(turb) > 5) contributingFactors.push('High Turbidity')
    if (sensorEnabled.ph && ph !== '--' && (Number(ph) < 6.5 || Number(ph) > 8.5)) contributingFactors.push('Unstable pH')
  }

  // Trend Analysis — prefer ML field7 from feeds; fall back to heuristic
  const getTrend = () => {
    if (feeds.length < 2) return null
    const getScore = (feed) => {
      if (feed.field7 && !isNaN(Number(feed.field7))) return Number(feed.field7)
      const t = Number(feed.field2) + offsets.temp
      const p = Number(feed.field1) + offsets.ph
      const tb = Number(feed.field5)
      const f = Number(feed.field4)
      const td = Number(feed.field6) + offsets.tds
      if ([t, p, tb, f, td].some(isNaN)) return null
      return predictBiofilmRisk(t, p, tb, f, td)
    }
    const curr = getScore(feeds[feeds.length - 1])
    const prev = getScore(feeds[feeds.length - 2])
    if (curr === null || prev === null) return null
    const diff = curr - prev
    if (Math.abs(diff) < 2) return { dir: 'stable', diff: 0 }
    return { dir: diff > 0 ? 'up' : 'down', diff: Math.abs(diff) }
  }
  const trend = getTrend()

  // DSS Decision — use 0 for turb if sensor is disabled so NaN doesn't break the check
  const dssDecision = (ph !== '--') ? dssLogic(riskScore, Number(ph), turb !== '--' ? Number(turb) : 0) : 'Waiting for data...'

  // Suggested Actions/Treatments
  const treatments = (ph !== '--') ? calculateTreatments(waterVolume, riskScore, dssDecision, ph) : []

  // Days since last maintenance (needed here and in JSX)
  const daysSinceMaintenance = useMemo(() => {
    if (!lastMaintenance) return 'Never'
    const diff = Date.now() - new Date(lastMaintenance).getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    return days === 0 ? 'Today' : `${days} days ago`
  }, [lastMaintenance])

  // Comprehensive Solution Plan
  const solutionPlan = (ph !== '--') ? getSolutionPlan(ph, temp, turb, tds, riskScore, waterVolume, daysSinceMaintenance, flow) : []

  const chartFeeds = shouldShowData ? feeds : []

  // Chart Data
  const chartData = {
    labels: chartFeeds.map(f => {
      const d = new Date(f.created_at)
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }),
    datasets: [
      {
        label: 'Biofilm Risk %',
        data: chartFeeds.map(f => {
          if (f.field7) return Number(f.field7) // Use ML Model History
          return predictBiofilmRisk(
            Number(f.field2) + offsets.temp,
            Number(f.field1) + offsets.ph,
            Number(f.field5),
            Number(f.field4),
            Number(f.field6) + offsets.tds
          )
        }),
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.2)',
        tension: 0.4,
        fill: true
      },
      {
        label: 'System Health %',
        data: chartFeeds.map(f => {
          const r = f.field7 ? Number(f.field7) : predictBiofilmRisk(
            Number(f.field2) + offsets.temp,
            Number(f.field1) + offsets.ph,
            Number(f.field5),
            Number(f.field4),
            Number(f.field6) + offsets.tds
          )
          return 100 - r
        }),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        tension: 0.4,
        fill: true
      }
    ]
  }

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' },
      tooltip: { mode: 'index', intersect: false }
    },
    scales: {
      y: { min: 0, max: 100, grid: { color: 'rgba(0,0,0,0.05)' } },
      x: { grid: { display: false } }
    },
    interaction: { mode: 'nearest', axis: 'x', intersect: false }
  }

  // Parameter Status
  const getParamStatus = (val, type) => {
    if (val === '--') return null
    const v = Number(val)
    if (type === 'ph') return (v < 6.5 || v > 8.5) ? 'caution' : 'normal'
    if (type === 'temp') return (v > 30) ? 'caution' : 'normal'
    if (type === 'flow') return (v < 1) ? 'caution' : 'normal'
    if (type === 'turb') return (v > 5) ? 'caution' : 'normal'
    if (type === 'tds') return (v > 500) ? 'caution' : 'normal'
    return 'normal' // default
  }

  const paramStatus = {
    ph: getParamStatus(ph, 'ph'),
    temp: getParamStatus(temp, 'temp'),
    flow: getParamStatus(flow, 'flow'),
    turb: getParamStatus(turb, 'turb'),
    tds: getParamStatus(tds, 'tds'),
    humidity: 'normal'
  }

  // Visual Bars % (clamped 0-100 for width)
  const calcBar = (val, max) => {
    if (val === '--') return 0
    return Math.min(100, Math.max(0, (Number(val) / max) * 100))
  }

  const phBar = calcBar(ph, 14)
  const tempBar = calcBar(temp, 50)
  const humidityBar = calcBar(humidity, 100)
  const flowBar = calcBar(flow, 100)
  const turbBar = calcBar(turb, 20)
  const tdsBar = calcBar(tds, 1000)

  const handleExport = () => {
    if (!feeds.length) return
    const headers = ['created_at', 'ph', 'temp', 'humidity', 'flow', 'turbidity', 'tds', 'risk_score', 'status']
    const csv = [
      headers.join(','),
      ...feeds.map(row => [
        row.created_at,
        Number(row.field1) + offsets.ph,
        Number(row.field2) + offsets.temp,
        row.field3,
        row.field4,
        row.field5,
        Number(row.field6) + offsets.tds,
        row.field7,
        row.field8
      ].join(','))
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `biofilm_data_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const generatePDF = () => {
    const doc = new jsPDF()
    const now = new Date().toLocaleString()

    // Title
    doc.setFontSize(22)
    doc.setTextColor(37, 99, 235) // Primary Blue
    doc.text("Biofilm Risk Detection Report", 14, 20)

    // Meta Info
    doc.setFontSize(10)
    doc.setTextColor(100)
    doc.text(`Generated: ${now}`, 14, 28)
    doc.text(`System Status: ${connectionStatus === 'connected' ? 'Online' : 'Offline'}`, 14, 33)

    // Executive Summary
    doc.setFontSize(14)
    doc.setTextColor(0)
    doc.text("Executive Summary", 14, 45)

    doc.setFontSize(11)
    doc.text(`Current Risk Level: ${riskScore.toFixed(1)}% (${riskBadge.text})`, 14, 53)
    doc.text(`System Health: ${healthPct}%`, 14, 59)
    doc.text(`Biofilm Stage: ${biofilmStage.stage}`, 14, 65)
    doc.text(`Last Maintenance: ${daysSinceMaintenance}`, 14, 71)

    // Sensor Status Snapshot
    doc.setFontSize(14)
    doc.text("Sensor Status Snapshot", 14, 85)

    const sensors = [
      ['Parameter', 'Value', 'Status'],
      ['pH Level', ph, paramStatus.ph === 'caution' ? 'Check Needed' : 'Normal'],
      ['Temperature', `${temp}°C`, paramStatus.temp === 'caution' ? 'High' : 'Normal'],
      ['Turbidity', `${turb} NTU`, paramStatus.turb === 'caution' ? 'High' : 'Normal'],
      ['Flow Rate', `${flow} L/m`, paramStatus.flow === 'caution' ? 'Low' : 'Normal'],
      ['TDS', `${tds} ppm`, paramStatus.tds === 'caution' ? 'High' : 'Normal'],
    ]

    autoTable(doc, {
      startY: 90,
      head: [sensors[0]],
      body: sensors.slice(1),
      theme: 'striped',
      headStyles: { fillColor: [37, 99, 235] },
      styles: { fontSize: 10 }
    })

    // Data Logs
    doc.setFontSize(14)
    doc.text("Recent Data Logs (Last 10 Readings)", 14, doc.lastAutoTable.finalY + 15)

    const tableData = feeds.map(row => [
      new Date(row.created_at).toLocaleTimeString(),
      row.field1 ? (Number(row.field1) + offsets.ph).toFixed(2) : '--',
      row.field2 ? (Number(row.field2) + offsets.temp).toFixed(1) : '--',
      row.field5 ? Number(row.field5).toFixed(2) : '--',
      row.field7 ? (Number(row.field7).toFixed(1) + '%') : 'N/A'
    ])

    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 20,
      head: [['Time', 'pH', 'Temp (C)', 'Turbidity', 'Risk %']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [60, 60, 60] },
      styles: { fontSize: 9 }
    })

    doc.save(`biofilm_risk_report_${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1>Biofilm Risk Detection</h1>
          <div style={{ display: 'flex', gap: '12px', marginTop: '8px', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            <span>IoT-Enabled Real-Time Monitor</span>
            <span>•</span>
            <span>Last updated: {lastUpdate || 'Connecting...'}</span>
          </div>
        </div>
        <div className="header-right">
          <div className={`system-status ${connectionStatus === 'connected' ? 'system-active pulse-animation' : connectionStatus === 'simulated' ? 'system-simulated pulse-animation' : 'system-offline'}`}>
            {connectionStatus === 'connected' ? '● System Active' : connectionStatus === 'simulated' ? '● System Simulated' : '● System Inactive'}
          </div>
          <div className="theme-toggle-wrapper" title="Toggle Theme">
            <input
              type="checkbox"
              id="theme-toggle-checkbox"
              className="theme-toggle-checkbox"
              checked={theme === 'dark'}
              onChange={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            />
            <label htmlFor="theme-toggle-checkbox" className="theme-toggle-label">
              <span className="theme-toggle-slider">
                <span className="theme-icon">{theme === 'light' ? '☀️' : '🌙'}</span>
              </span>
            </label>
          </div>
          <button
            className="theme-toggle"
            onClick={() => setShowSettings(true)}
            title="Settings & Calibration"
          >
            <Settings size={20} />
          </button>
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
          <div className="card" style={{ width: '90%', maxWidth: '450px', padding: '32px', animation: 'fadeIn 0.3s ease-out' }}>
            <h3 style={{ marginBottom: '24px', fontSize: '1.5rem', background: 'var(--primary-gradient)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Settings & Calibration</h3>

            <div style={{ marginBottom: '24px' }}>
              <h4 style={{ marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                Maintenance
                <small style={{ color: 'var(--text-muted)', fontWeight: 'normal', fontSize: '0.9rem' }}>Last: {daysSinceMaintenance}</small>
              </h4>
              <button
                onClick={() => { addMaintenanceEntry('Quick Log', 'Logged via Settings'); alert('Maintenance Logged!') }}
                style={{ width: '100%', padding: '12px', background: 'var(--success-gradient)', color: 'white', border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 6px rgba(16, 185, 129, 0.2)' }}
              >
                <Check size={16} style={{ display: 'inline', marginRight: '6px' }} />
                Log Cleaning / Maintenance
              </button>
            </div>

            <div style={{ marginBottom: '24px' }}>
              <h4 style={{ marginBottom: '12px' }}>Sensor Configuration</h4>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '12px', lineHeight: '1.5' }}>
                Disable sensors that are not physically connected. Disabled sensors are excluded from risk calculations.
              </p>
              <div style={{ display: 'grid', gap: '10px' }}>
                {[
                  { key: 'ph', label: 'pH Sensor', note: '' },
                  { key: 'temp', label: 'Temperature Sensor', note: '' },
                  { key: 'humidity', label: 'Humidity Sensor', note: '' },
                  { key: 'flow', label: 'Flow Sensor', note: '⚠️ Isolated — saved for deployment' },
                  { key: 'turb', label: 'Turbidity Sensor', note: '' },
                  { key: 'tds', label: 'TDS Sensor', note: '' },
                ].map(({ key, label, note }) => (
                  <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: '10px', background: sensorEnabled[key] ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.06)', border: `1px solid ${sensorEnabled[key] ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.2)'}`, transition: 'all 0.3s' }}>
                    <div>
                      <span style={{ fontWeight: '500', fontSize: '0.9rem' }}>{label}</span>
                      {note && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>{note}</div>}
                    </div>
                    <button
                      onClick={() => toggleSensor(key)}
                      style={{
                        width: '48px', height: '26px', borderRadius: '13px', border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0,
                        background: sensorEnabled[key] ? 'linear-gradient(135deg, #10b981, #059669)' : '#94a3b8',
                        transition: 'background 0.3s', boxShadow: sensorEnabled[key] ? '0 0 8px rgba(16,185,129,0.4)' : 'none'
                      }}
                      title={sensorEnabled[key] ? 'Click to disable sensor' : 'Click to enable sensor'}
                    >
                      <span style={{
                        position: 'absolute', top: '3px', left: sensorEnabled[key] ? '25px' : '3px',
                        width: '20px', height: '20px', borderRadius: '50%', background: 'white',
                        transition: 'left 0.25s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                      }} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '24px' }}>
              <h4 style={{ marginBottom: '12px' }}>Sensor Offsets</h4>
              <div style={{ display: 'grid', gap: '12px' }}>
                <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  pH Offset
                  <input type="number" step="0.1" value={offsets.ph} onChange={e => setOffsets({ ...offsets, ph: Number(e.target.value) })} style={{ width: '100px' }} />
                </label>
                <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  Temp Offset (°C)
                  <input type="number" step="0.1" value={offsets.temp} onChange={e => setOffsets({ ...offsets, temp: Number(e.target.value) })} style={{ width: '100px' }} />
                </label>
                <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  TDS Offset (ppm)
                  <input type="number" step="1" value={offsets.tds} onChange={e => setOffsets({ ...offsets, tds: Number(e.target.value) })} style={{ width: '100px' }} />
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={handleExport} style={{ flex: 1, padding: '12px', background: 'var(--primary-gradient)', color: 'white', border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: '600', boxShadow: '0 4px 6px rgba(37, 99, 235, 0.2)' }}>
                📥 Export CSV
              </button>
              <button onClick={generatePDF} style={{ flex: 1, padding: '12px', background: '#4b5563', color: 'white', border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: '600', boxShadow: '0 4px 6px rgba(75, 85, 99, 0.2)' }}>
                📄 PDF Report
              </button>
              <button onClick={() => setShowSettings(false)} style={{ flex: 0.5, padding: '12px', background: 'transparent', border: '1px solid var(--glass-border)', color: 'var(--text-muted)', borderRadius: '12px', cursor: 'pointer', fontWeight: '600' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {isSimulated && (
        <div style={{ padding: '16px', background: 'linear-gradient(135deg, rgba(245,158,11,0.1), rgba(239,68,68,0.05))', borderRadius: '12px', marginBottom: '24px', border: '1px solid rgba(245,158,11,0.3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h4 style={{ margin: 0, color: '#b45309', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={18} /> ESP32 is Disconnected
            </h4>
            <p style={{ margin: '4px 0 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              The system is receiving simulated data over ThingSpeak for demonstration purposes.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-main)' }}>Show Simulated Data?</span>
            <button
              onClick={() => setShowSimulatedData(!showSimulatedData)}
              style={{
                width: '60px', height: '32px', borderRadius: '16px', border: 'none', cursor: 'pointer', position: 'relative',
                background: showSimulatedData ? 'linear-gradient(135deg, #10b981, #059669)' : '#94a3b8',
                transition: 'background 0.3s', boxShadow: showSimulatedData ? '0 0 8px rgba(16,185,129,0.4)' : 'none'
              }}
            >
              <span style={{
                position: 'absolute', top: '4px', left: showSimulatedData ? '32px' : '4px',
                width: '24px', height: '24px', borderRadius: '50%', background: 'white',
                transition: 'left 0.25s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
              }} />
            </button>
          </div>
        </div>
      )}

      <div className="top-section">
        {/* Biofilm Risk Card - Redesigned */}
        <div className="card rich-card animate-fade-in hover-scale">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3>Biofilm Risk Prediction</h3>
              <p className="card-desc" style={{ marginBottom: '20px' }}>Real-time growth probability analysis.</p>
            </div>
            <div className={`icon-wrapper ${riskScore > 60 ? 'red' : riskScore > 30 ? 'orange' : 'green'} animate-scale-in`}>
              {riskScore > 60 ? <AlertTriangle /> : <Activity />}
            </div>
          </div>

          <div className="ring-container">
            {/* Simple SVG Ring visual */}
            <svg style={{ transform: 'rotate(-90deg)' }} width="120" height="120">
              <circle cx="60" cy="60" r="54" fill="none" stroke="var(--glass-border)" strokeWidth="12" />
              <circle
                cx="60" cy="60" r="54"
                fill="none"
                stroke={riskScore > 60 ? 'var(--danger)' : riskScore > 30 ? 'var(--warning)' : 'var(--success)'}
                strokeWidth="12"
                strokeDasharray={339.292}
                strokeDashoffset={339.292 - (339.292 * riskScore) / 100}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 1s ease-in-out' }}
              />
            </svg>
            <div className="ring-value">{riskPercent}</div>
          </div>

          <div style={{ textAlign: 'center' }}>
            <span className={riskBadge.className}>{riskBadge.text}</span>
            {trend && (
              <p className="risk-trend" style={{ marginTop: '12px', fontSize: '0.9rem' }}>
                {trend.dir === 'up' && <span style={{ color: 'var(--danger)' }}>Trends ↑ {trend.diff}%</span>}
                {trend.dir === 'down' && <span style={{ color: 'var(--success)' }}>Trends ↓ {trend.diff}%</span>}
                {trend.dir === 'stable' && <span style={{ color: 'var(--text-muted)' }}>Stable vs last reading</span>}
              </p>
            )}
          </div>
        </div>

        {/* System Health Card - Redesigned */}
        <div className="card rich-card animate-fade-in hover-scale" style={{ animationDelay: '0.2s' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3>System Health</h3>
              <p className="card-desc" style={{ marginBottom: '20px' }}>Overall stability and resilience.</p>
            </div>
            <div className={`icon-wrapper ${healthPct > 70 ? 'green' : healthPct > 40 ? 'orange' : 'red'} animate-scale-in`}>
              <Shield />
            </div>
          </div>

          <div className="ring-container">
            <svg style={{ transform: 'rotate(-90deg)' }} width="120" height="120">
              <circle cx="60" cy="60" r="54" fill="none" stroke="var(--glass-border)" strokeWidth="12" />
              <circle
                cx="60" cy="60" r="54"
                fill="none"
                stroke={healthPct > 70 ? 'var(--success)' : healthPct > 40 ? 'var(--warning)' : 'var(--danger)'}
                strokeWidth="12"
                strokeDasharray={339.292}
                strokeDashoffset={339.292 - (339.292 * healthPct) / 100}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 1s ease-in-out' }}
              />
            </svg>
            <div className="ring-value">{healthPct}%</div>
          </div>

          <div style={{ textAlign: 'center', marginTop: '8px' }}>
            <p className="risk-factors">
              {contributingFactors.length ? (
                <>
                  <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Strain Factors:</span>
                  {contributingFactors.join(' • ')}
                </>
              ) : (
                <span style={{ color: 'var(--success)' }}>Optimal Conditions</span>
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card animate-slide-up stagger-1 hover-scale">
          <h4>Biofilm Stage</h4>
          <div className="icon-wrapper blue" style={{ marginBottom: '12px' }}><Microscope size={20} /></div>
          <div className="stat-value">{biofilmStage.stage}</div>
          <div className="stat-sub">{biofilmStage.desc}</div>
        </div>

        <div className="stat-card animate-slide-up stagger-2 hover-scale">
          <h4>Data Confidence</h4>
          <div className="icon-wrapper orange" style={{ marginBottom: '12px' }}><Activity size={20} /></div>
          <div className="stat-value">{[ph, temp, flow, turb, tds].filter(v => v !== '--').length}/5 Active</div>
          <div className="stat-sub">Live Sensor Streams</div>
        </div>

        <div className="stat-card animate-slide-up stagger-3 hover-scale">
          <h4>DSS Decision</h4>
          <div className={`icon-wrapper ${dssDecision.includes('Normal') ? 'green' : 'red'}`} style={{ marginBottom: '12px' }}>
            {dssDecision.includes('Normal') ? <Check size={20} /> : <AlertTriangle size={20} />}
          </div>
          <div className="stat-value" style={{ fontSize: '1rem' }}>{dssDecision}</div>
        </div>

        <div className="stat-card animate-slide-up stagger-4 hover-scale">
          <h4>Dev. Status</h4>
          <div className={`icon-wrapper ${connectionStatus === 'connected' ? 'green' : 'red'}`} style={{ marginBottom: '12px' }}>
            {connectionStatus === 'connected' ? <Wifi size={20} /> : <WifiOff size={20} />}
          </div>
          <div className="stat-value">
            {connectionStatus === 'connected' ? 'Online' : 'Offline'}
          </div>
          <div className="stat-sub">
            {connectionStatus === 'connected' ? 'Signal Stable' : 'Last Logged Data'}
          </div>
        </div>

        <div className="stat-card animate-slide-up stagger-4 hover-scale" style={{ animationDelay: '0.5s' }}>
          <h4>Last Maint.</h4>
          <div className="icon-wrapper green" style={{ marginBottom: '12px' }}><Settings size={20} /></div>
          <div className="stat-value">{daysSinceMaintenance}</div>
          <div className="stat-sub">{lastMaintenance ? new Date(lastMaintenance).toLocaleDateString() : 'No record'}</div>
        </div>

        <div className="stat-card animate-slide-up stagger-4 hover-scale" style={{ animationDelay: '0.6s' }}>
          <h4>Water Volume</h4>
          <div className="icon-wrapper blue" style={{ marginBottom: '12px' }}><Droplet size={20} /></div>
          <div className="stat-value">{waterVolume.toLocaleString()} L</div>
          <div className="stat-sub">System Capacity</div>
        </div>

        <div className="stat-card animate-slide-up stagger-4 hover-scale" style={{ animationDelay: '0.7s' }}>
          <h4>Avg. Risk (1h)</h4>
          <div className="icon-wrapper orange" style={{ marginBottom: '12px' }}><Activity size={20} /></div>
          <div className="stat-value">{chartFeeds.length > 0 ? (() => {
            const risks = chartFeeds.map(f => {
              if (f.field7 && !isNaN(Number(f.field7))) return Number(f.field7)
              return predictBiofilmRisk(
                Number(f.field2 || 25) + offsets.temp,
                Number(f.field1 || 7) + offsets.ph,
                Number(f.field5 || 0),
                Number(f.field4 || 100),
                Number(f.field6 || 0) + offsets.tds
              )
            })
            return (risks.reduce((a, b) => a + b, 0) / risks.length).toFixed(1)
          })() : '0.0'}%</div>
          <div className="stat-sub">Recent Trend</div>
        </div>

        <div className="stat-card animate-slide-up stagger-4 hover-scale" style={{ animationDelay: '0.8s' }}>
          <h4>Recommended Actions</h4>
          <div className={`icon-wrapper ${treatments.length > 0 ? 'red' : 'green'}`} style={{ marginBottom: '12px' }}>
            {treatments.length > 0 ? <AlertTriangle size={20} /> : <Check size={20} />}
          </div>
          <div className="stat-value" style={{ fontSize: '1rem' }}>
            {treatments.length > 0 ? `${treatments.length} Action${treatments.length > 1 ? 's' : ''}` : 'None'}
          </div>
          <div className="stat-sub">
            {treatments.length > 0 ? treatments[0].reason : 'System Normal'}
          </div>
        </div>
      </div>

      <div className="card rich-card chart-card animate-fade-in" style={{ marginTop: '32px', animationDelay: '0.4s' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h3>Real-time Monitoring</h3>
            <p className="card-desc">Biofilm risk % and system health % over the last 10 readings.</p>
          </div>
          <div style={{ padding: '6px 12px', background: 'rgba(0,0,0,0.05)', borderRadius: '20px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Updates every 5s
          </div>
        </div>

        {chartFeeds.length > 0 ? (
          <div className="chart-wrapper">
            <Line data={chartData} options={chartOptions} />
          </div>
        ) : (
          <div className="chart-placeholder">Collecting data… Chart will appear when data is available.</div>
        )}
      </div>

      {/* ====== AI MODEL INTELLIGENCE PANEL ====== */}
      <div className="card rich-card animate-fade-in" style={{ marginTop: '32px', background: isAiActive ? 'linear-gradient(145deg, rgba(16,185,129,0.06), rgba(59,130,246,0.04))' : 'linear-gradient(145deg, rgba(245,158,11,0.06), rgba(239,68,68,0.03))', border: isAiActive ? '1px solid rgba(16,185,129,0.2)' : '1px solid rgba(245,158,11,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: '52px', height: '52px', borderRadius: '14px', background: isAiActive ? 'linear-gradient(135deg, #10b981, #2563eb)' : 'linear-gradient(135deg, #f59e0b, #ef4444)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem', flexShrink: 0, boxShadow: isAiActive ? '0 4px 16px rgba(16,185,129,0.3)' : '0 4px 16px rgba(245,158,11,0.3)' }}>
              🧠
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.3rem' }}>AI Prediction Engine</h3>
              <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>Hybrid Ensemble · RF + XGBoost + LSTM</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ padding: '6px 14px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: '700', background: isAiActive ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)', color: isAiActive ? '#10b981' : '#f59e0b', border: `1px solid ${isAiActive ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'}` }}>
              {isAiActive ? '● ML MODEL ACTIVE' : '○ HEURISTIC FALLBACK'}
            </span>
            <span style={{ padding: '6px 14px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: '600', background: 'rgba(59,130,246,0.1)', color: '#2563eb', border: '1px solid rgba(59,130,246,0.2)' }}>
              {isAiActive ? `Prediction: ${riskScore.toFixed(1)}%` : `Estimate: ${riskScore.toFixed(1)}%`}
            </span>
          </div>
        </div>

        {/* Status Message */}
        {!isAiActive && (
          <div style={{ padding: '12px 16px', borderRadius: '10px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', marginBottom: '20px', fontSize: '0.875rem', color: '#b45309' }}>
            ⚠️ <strong>test.py is not running.</strong> The dashboard is using a heuristic formula as fallback. Start <code>test.py</code> to activate the Hybrid Ensemble AI model and send live predictions via ThingSpeak field7.
          </div>
        )}
        {isAiActive && (
          <div style={{ padding: '12px 16px', borderRadius: '10px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', marginBottom: '20px', fontSize: '0.875rem', color: '#065f46' }}>
            ✅ <strong>Hybrid ML model is live.</strong> Predictions are sourced from the trained Hybrid Ensemble (RF + XGBoost + LSTM) running on the edge device and uploaded via ThingSpeak field7 every 16s.
          </div>
        )}

        {/* Architecture Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
          {[
            { name: 'Random Forest', emoji: '🌲', role: 'Tabular Regressor', detail: '100 trees · depth 10', r2: '≥0.95', color: '#10b981' },
            { name: 'XGBoost', emoji: '⚡', role: 'Gradient Boosting', detail: '100 estimators · lr 0.1', r2: '≥0.96', color: '#2563eb' },
            { name: 'LSTM', emoji: '🔁', role: 'Time-Series Memory', detail: '64+32 units · seq=10', r2: '≥0.94', color: '#7c3aed' },
          ].map(m => (
            <div key={m.name} style={{ padding: '16px', borderRadius: '12px', background: 'rgba(0,0,0,0.03)', border: '1px solid var(--glass-border)', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, width: '3px', height: '100%', background: m.color, borderRadius: '3px 0 0 3px' }} />
              <div style={{ marginLeft: '8px' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: '4px' }}>{m.emoji}</div>
                <div style={{ fontWeight: '700', fontSize: '0.95rem', color: m.color }}>{m.name}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '2px 0' }}>{m.role}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{m.detail}</div>
                <div style={{ marginTop: '8px', fontSize: '0.8rem', fontWeight: '600', color: m.color }}>R² {m.r2}</div>
              </div>
            </div>
          ))}
          <div style={{ padding: '16px', borderRadius: '12px', background: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(59,130,246,0.08))', border: '1px solid rgba(99,102,241,0.2)', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, width: '3px', height: '100%', background: 'linear-gradient(to bottom, #10b981, #2563eb, #7c3aed)', borderRadius: '3px 0 0 3px' }} />
            <div style={{ marginLeft: '8px' }}>
              <div style={{ fontSize: '1.5rem', marginBottom: '4px' }}>🏆</div>
              <div style={{ fontWeight: '700', fontSize: '0.95rem', background: 'linear-gradient(135deg, #10b981, #2563eb)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Hybrid Ensemble</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '2px 0' }}>Averaged Output</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>(RF + XGB + LSTM) / 3</div>
              <div style={{ marginTop: '8px', fontSize: '0.8rem', fontWeight: '600', color: '#4f46e5' }}>R² ≥0.97 · Best Model</div>
            </div>
          </div>
        </div>

        {/* Data Flow */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Data Flow Pipeline</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {[
              { label: 'ESP32 Sensors', sub: 'pH, Temp, Humidity, Flow, Turb, TDS', emoji: '📡' },
              { label: 'test.py', sub: 'Edge AI Inference', emoji: '🐍' },
              { label: 'Hybrid Model', sub: 'RF + XGB + LSTM', emoji: '🧠' },
              { label: 'ThingSpeak', sub: 'Cloud IoT (field7)', emoji: '☁️' },
              { label: 'Dashboard', sub: 'React Live Display', emoji: '📊' },
            ].map((step, i, arr) => (
              <div key={step.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'rgba(0,0,0,0.04)', border: '1px solid var(--glass-border)', textAlign: 'center', minWidth: '110px' }}>
                  <div style={{ fontSize: '1.2rem' }}>{step.emoji}</div>
                  <div style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-main)', marginTop: '2px' }}>{step.label}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{step.sub}</div>
                </div>
                {i < arr.length - 1 && <span style={{ color: 'var(--text-muted)', fontSize: '1.2rem', flexShrink: 0 }}>→</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Feature Inputs */}
        <div>
          <div style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Model Input Features</div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[
              { label: 'pH', val: ph, icon: '🧪', enabled: sensorEnabled.ph },
              { label: 'Temperature', val: temp, icon: '🌡️', enabled: sensorEnabled.temp },
              { label: 'Humidity', val: humidity, icon: '💧', enabled: sensorEnabled.humidity },
              { label: 'Flow', val: flow, icon: '🌊', enabled: sensorEnabled.flow },
              { label: 'Turbidity', val: turb, icon: '🔶', enabled: sensorEnabled.turb },
              { label: 'TDS', val: tds, icon: '⚗️', enabled: sensorEnabled.tds },
            ].map(f => (
              <div key={f.label} style={{ padding: '8px 12px', borderRadius: '8px', background: f.enabled ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.06)', border: `1px solid ${f.enabled ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.15)'}`, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>{f.icon}</span>
                <span style={{ fontWeight: '600', color: 'var(--text-main)' }}>{f.label}</span>
                <span style={{ color: f.enabled ? '#10b981' : '#ef4444' }}>{f.val !== '--' ? f.val : (f.enabled ? '--' : 'OFF')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Advanced Visualizations: Deep Dive */}
      <div className="top-section" style={{ marginTop: '32px' }}>
        <div className="card rich-card animate-fade-in" style={{ animationDelay: '0.6s' }}>
          <h3>Water Quality Profile</h3>
          <p className="card-desc">Normalized metrics (0-100) to visualize balance.</p>
          <div style={{ height: '300px', display: 'flex', justifyContent: 'center' }}>
            <Radar
              data={{
                labels: ['pH', 'Temp', 'Flow', 'Turbidity', 'TDS'],
                datasets: [{
                  label: 'Current Status',
                  data: [
                    ph !== '--' ? (Number(ph) / 14) * 100 : 0,
                    temp !== '--' ? (Number(temp) / 50) * 100 : 0,
                    flow !== '--' ? (Number(flow) / 100) * 100 : 0,
                    turb !== '--' ? (Number(turb) / 20) * 100 : 0,
                    tds !== '--' ? (Number(tds) / 1000) * 100 : 0
                  ],
                  backgroundColor: theme === 'dark' ? 'rgba(96, 165, 250, 0.2)' : 'rgba(37, 99, 235, 0.2)',
                  borderColor: theme === 'dark' ? '#60a5fa' : '#2563eb',
                  borderWidth: 2,
                  pointBackgroundColor: theme === 'dark' ? '#60a5fa' : '#2563eb',
                  pointBorderColor: '#fff',
                  pointHoverBackgroundColor: '#fff',
                  pointHoverBorderColor: theme === 'dark' ? '#60a5fa' : '#2563eb',
                }]
              }}
              options={{
                scales: {
                  r: {
                    suggestedMin: 0,
                    suggestedMax: 100,
                    grid: { color: theme === 'dark' ? 'rgba(148, 163, 184, 0.2)' : 'rgba(0,0,0,0.1)' },
                    angleLines: { color: theme === 'dark' ? 'rgba(148, 163, 184, 0.2)' : 'rgba(0,0,0,0.1)' },
                    pointLabels: {
                      color: theme === 'dark' ? '#cbd5e1' : '#64748b',
                      font: { size: 12 }
                    },
                    ticks: {
                      color: theme === 'dark' ? '#94a3b8' : '#64748b',
                      backdropColor: 'transparent'
                    }
                  }
                },
                plugins: {
                  legend: {
                    display: true,
                    labels: {
                      color: theme === 'dark' ? '#cbd5e1' : '#64748b'
                    }
                  }
                }
              }}
            />
          </div>
        </div>

        <div className="card rich-card animate-fade-in" style={{ animationDelay: '0.7s' }}>
          <h3>Safety Thresholds</h3>
          <p className="card-desc">Current values vs. Recommended Limits.</p>
          <div style={{ height: '300px' }}>
            <Bar
              plugins={[{
                id: 'limitLine',
                afterDatasetsDraw: (chart) => {
                  const { ctx, scales: { x }, chartArea: { top, bottom } } = chart
                  if (!x) return
                  const xValue = x.getPixelForValue(100)

                  ctx.save()
                  ctx.beginPath()
                  ctx.lineWidth = 2
                  ctx.strokeStyle = '#a0a0a0ff'
                  ctx.setLineDash([6, 4])
                  ctx.moveTo(xValue, top)
                  ctx.lineTo(xValue, bottom)
                  ctx.stroke()
                  ctx.restore()
                }
              }]}
              data={{
                labels: ['pH', 'Temperature', 'Turbidity'],
                datasets: [
                  // Layer 1: The Value Bar
                  {
                    label: 'Current Level',
                    data: [
                      (Number(ph) / 8.5) * 100,
                      (Number(temp) / 30) * 100,
                      (Number(turb) / 5) * 100
                    ],
                    backgroundColor: (context) => {
                      const val = context.raw
                      // Red if Critical (>100%), otherwise Identity Color
                      if (val > 100) return '#ef4444'

                      // Identity Colors
                      if (context.dataIndex === 0) return '#3b82f6' // pH: Blue
                      if (context.dataIndex === 1) return '#f59e0b' // Temp: Orange
                      if (context.dataIndex === 2) return '#10b981' // Turb: Green
                      return '#64748b'
                    },
                    borderRadius: 6,
                    barPercentage: 0.6,
                    categoryPercentage: 0.8,
                    order: 1, // Draw behind line
                  },
                  // Layer 2: The Limit Line (Keep for Legend, but line drawn by plugin covers it)
                  {
                    label: 'Safety Limit',
                    data: [100, 100, 100],
                    type: 'line',
                    borderColor: '#ef4444', // Keep color for Legend
                    borderWidth: 0,         // Hide the dataset line (drawn by plugin)
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    fill: false,
                    order: 0
                  }
                ]
              }}
              options={{
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                  padding: { right: 30 } // Space for tooltips/labels
                },
                scales: {
                  x: {
                    beginAtZero: true,
                    max: 120, // Enough room to show "Over Limit" bars
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    title: { display: true, text: '% of Safe Limit' }
                  },
                  y: {
                    grid: { display: false },
                    ticks: {
                      font: { weight: 'bold', size: 12 },
                      autoSkip: false
                    }
                  }
                },
                plugins: {
                  legend: {
                    display: true,
                    position: 'bottom',
                    labels: { usePointStyle: true, padding: 20 }
                  },
                  tooltip: {
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    titleColor: '#1e293b',
                    bodyColor: '#475569',
                    borderColor: '#e2e8f0',
                    borderWidth: 1,
                    padding: 12,
                    boxPadding: 4,
                    callbacks: {
                      label: (context) => {
                        const val = context.raw
                        // Generic label for limit line
                        if (context.dataset.label === 'Safety Limit') return 'Safety Limit: 100%'

                        let realVal = 0, limit = 0, unit = ''
                        if (context.dataIndex === 0) { realVal = Number(ph); limit = 8.5; unit = '' }
                        if (context.dataIndex === 1) { realVal = Number(temp); limit = 30; unit = '°C' }
                        if (context.dataIndex === 2) { realVal = Number(turb); limit = 5; unit = 'NTU' }

                        const pct = val.toFixed(1)
                        return `${realVal}${unit} (Limit: ${limit}${unit}) • ${pct}%`
                      }
                    }
                  }
                }
              }}
            />
          </div>
        </div>
      </div>

      <div className="params animate-slide-up" style={{ animationDelay: '0.5s' }}>
        {/* pH */}
        <div className={`param-card hover-scale${!sensorEnabled.ph ? ' sensor-disabled' : ''}`}>
          <h4>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Droplet size={16} color={sensorEnabled.ph ? 'var(--primary)' : 'var(--text-muted)'} /> pH</span>
            <span className="param-meta">optimal 6.5–8.5</span>
          </h4>
          {!sensorEnabled.ph
            ? <div className="sensor-isolated-badge">⛔ Isolated — Not in use</div>
            : <>
              <div className="bar"><span style={{ width: phBar + '%', background: paramStatus.ph === 'caution' ? 'var(--warning-gradient)' : 'var(--success-gradient)' }} /></div>
              <div className="param-row">
                <small className="param-value">{ph}</small>
                <span className={`param-status param-status--${paramStatus.ph || 'none'}`}>{paramStatus.ph === 'caution' ? 'Caution' : paramStatus.ph === 'normal' ? 'Normal' : '—'}</span>
              </div>
            </>}
          <button className="sensor-toggle-mini" onClick={() => toggleSensor('ph')} title={sensorEnabled.ph ? 'Disable sensor' : 'Enable sensor'}>
            <span className={`sensor-toggle-dot${sensorEnabled.ph ? ' on' : ''}`} />
            {sensorEnabled.ph ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Temperature */}
        <div className={`param-card${!sensorEnabled.temp ? ' sensor-disabled' : ''}`}>
          <h4>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Thermometer size={16} color={sensorEnabled.temp ? 'var(--danger)' : 'var(--text-muted)'} /> Temp</span>
            <span className="param-meta">optimal ≤30 °C</span>
          </h4>
          {!sensorEnabled.temp
            ? <div className="sensor-isolated-badge">⛔ Isolated — Not in use</div>
            : <>
              <div className="bar"><span style={{ width: tempBar + '%', background: paramStatus.temp === 'caution' ? 'var(--warning-gradient)' : 'var(--success-gradient)' }} /></div>
              <div className="param-row">
                <small className="param-value">{temp !== '--' ? `${temp} °C` : temp}</small>
                <span className={`param-status param-status--${paramStatus.temp || 'none'}`}>{paramStatus.temp === 'caution' ? 'Caution' : paramStatus.temp === 'normal' ? 'Normal' : '—'}</span>
              </div>
            </>}
          <button className="sensor-toggle-mini" onClick={() => toggleSensor('temp')} title={sensorEnabled.temp ? 'Disable sensor' : 'Enable sensor'}>
            <span className={`sensor-toggle-dot${sensorEnabled.temp ? ' on' : ''}`} />
            {sensorEnabled.temp ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Humidity (informational only — not used in DSS) */}
        <div className={`param-card${!sensorEnabled.humidity ? ' sensor-disabled' : ''}`}>
          <h4>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Cloud size={16} color={sensorEnabled.humidity ? 'var(--text-muted)' : 'var(--text-muted)'} /> Humidity</span>
            <span className="param-meta">typical 40–60%</span>
          </h4>
          {!sensorEnabled.humidity
            ? <div className="sensor-isolated-badge">⛔ Isolated — Not in use</div>
            : <>
              <div className="bar"><span style={{ width: humidityBar + '%', background: 'var(--primary-gradient)' }} /></div>
              <div className="param-row">
                <small className="param-value">{humidity !== '--' ? `${humidity} %` : humidity}</small>
                <span className="param-status param-status--none">Info</span>
              </div>
            </>}
          <button className="sensor-toggle-mini" onClick={() => toggleSensor('humidity')} title={sensorEnabled.humidity ? 'Disable sensor' : 'Enable sensor'}>
            <span className={`sensor-toggle-dot${sensorEnabled.humidity ? ' on' : ''}`} />
            {sensorEnabled.humidity ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Flow — defaults to OFF: sensor isolated, saved for deployment */}
        <div className={`param-card${!sensorEnabled.flow ? ' sensor-disabled' : ''}`}>
          <h4>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Wind size={16} color={sensorEnabled.flow ? 'var(--primary)' : 'var(--text-muted)'} /> Flow</span>
            <span className="param-meta">optimal ≥60 L/min</span>
          </h4>
          {!sensorEnabled.flow
            ? <div className="sensor-isolated-badge">🔌 Isolated — Saved for Deployment</div>
            : <>
              <div className="bar"><span style={{ width: flowBar + '%', background: paramStatus.flow === 'caution' ? 'var(--warning-gradient)' : 'var(--success-gradient)' }} /></div>
              <div className="param-row">
                <small className="param-value">{flow !== '--' ? `${flow} L/min` : flow}</small>
                <span className={`param-status param-status--${paramStatus.flow || 'none'}`}>{paramStatus.flow === 'caution' ? 'Caution' : paramStatus.flow === 'normal' ? 'Normal' : '—'}</span>
              </div>
            </>}
          <button className="sensor-toggle-mini" onClick={() => toggleSensor('flow')} title={sensorEnabled.flow ? 'Disable sensor' : 'Enable sensor'}>
            <span className={`sensor-toggle-dot${sensorEnabled.flow ? ' on' : ''}`} />
            {sensorEnabled.flow ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Turbidity */}
        <div className={`param-card${!sensorEnabled.turb ? ' sensor-disabled' : ''}`}>
          <h4>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Zap size={16} color={sensorEnabled.turb ? 'var(--warning)' : 'var(--text-muted)'} /> Turbidity</span>
            <span className="param-meta">optimal ≤5 NTU</span>
          </h4>
          {!sensorEnabled.turb
            ? <div className="sensor-isolated-badge">⛔ Isolated — Not in use</div>
            : <>
              <div className="bar"><span style={{ width: turbBar + '%', background: paramStatus.turb === 'caution' ? 'var(--warning-gradient)' : 'var(--success-gradient)' }} /></div>
              <div className="param-row">
                <small className="param-value">{turb !== '--' ? `${turb} NTU` : turb}</small>
                <span className={`param-status param-status--${paramStatus.turb || 'none'}`}>{paramStatus.turb === 'caution' ? 'Caution' : paramStatus.turb === 'normal' ? 'Normal' : '—'}</span>
              </div>
            </>}
          <button className="sensor-toggle-mini" onClick={() => toggleSensor('turb')} title={sensorEnabled.turb ? 'Disable sensor' : 'Enable sensor'}>
            <span className={`sensor-toggle-dot${sensorEnabled.turb ? ' on' : ''}`} />
            {sensorEnabled.turb ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* TDS */}
        <div className={`param-card${!sensorEnabled.tds ? ' sensor-disabled' : ''}`}>
          <h4>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Activity size={16} color={sensorEnabled.tds ? 'var(--text-muted)' : 'var(--text-muted)'} /> TDS</span>
            <span className="param-meta">optimal ≤500 ppm</span>
          </h4>
          {!sensorEnabled.tds
            ? <div className="sensor-isolated-badge">⛔ Isolated — Not in use</div>
            : <>
              <div className="bar"><span style={{ width: tdsBar + '%', background: paramStatus.tds === 'caution' ? 'var(--warning-gradient)' : 'var(--success-gradient)' }} /></div>
              <div className="param-row">
                <small className="param-value">{tds !== '--' ? `${tds} ppm` : tds}</small>
                <span className={`param-status param-status--${paramStatus.tds || 'none'}`}>{paramStatus.tds === 'caution' ? 'Caution' : paramStatus.tds === 'normal' ? 'Normal' : '—'}</span>
              </div>
            </>}
          <button className="sensor-toggle-mini" onClick={() => toggleSensor('tds')} title={sensorEnabled.tds ? 'Disable sensor' : 'Enable sensor'}>
            <span className={`sensor-toggle-dot${sensorEnabled.tds ? ' on' : ''}`} />
            {sensorEnabled.tds ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      <div className="card rich-card" style={{ marginTop: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className="icon-wrapper blue" style={{ marginBottom: 0, width: '40px', height: '40px' }}><FlaskConical size={20} /></div>
            <div>
              <h3 style={{ margin: 0 }}>Chemical Dosage</h3>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Automated treatment recommendations</p>
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            System Volume (L)
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="number"
                value={waterVolume}
                onChange={(e) => setWaterVolume(Math.max(0, Number(e.target.value)))}
                style={{ width: '80px', fontWeight: '600', padding: '8px', borderRadius: '8px', border: '1px solid var(--glass-border)' }}
              />
              <button
                onClick={estimateVolume}
                title="Auto-estimate from flow rate"
                style={{ padding: '8px', background: 'var(--primary-gradient)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
              >
                ⚡
              </button>
            </div>
          </label>
        </div>

        {treatments.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
            {treatments.map((t, i) => (
              <div key={i} style={{ padding: '20px', background: 'rgba(37, 99, 235, 0.05)', borderRadius: '16px', border: '1px solid rgba(37, 99, 235, 0.1)', transition: 'transform 0.2s' }}>
                <div style={{ fontWeight: '700', color: 'var(--primary)', marginBottom: '8px', fontSize: '1.1rem' }}>{t.name}</div>
                <div style={{ fontSize: '2rem', fontWeight: '800', display: 'flex', alignItems: 'baseline', gap: '6px', color: 'var(--text-main)' }}>
                  {t.amount} <span style={{ fontSize: '1rem', fontWeight: '500', color: 'var(--text-muted)' }}>{t.unit}</span>
                </div>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <AlertTriangle size={14} /> {t.reason}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{
            padding: '40px',
            textAlign: 'center',
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.05) 100%)',
            borderRadius: '16px',
            color: 'var(--success)',
            border: '1px solid rgba(16, 185, 129, 0.2)'
          }}>
            <div style={{ marginBottom: '16px', display: 'inline-flex', padding: '16px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.2)' }}>
              <Check size={32} />
            </div>
            <div style={{ fontWeight: '700', fontSize: '1.2rem' }}>System Nominal</div>
            <div style={{ opacity: 0.8, marginTop: '4px' }}>No chemical treatment required at this time.</div>
          </div>
        )}
      </div>

      {/* Comprehensive Solutions Section */}
      {solutionPlan.length > 0 && (
        <div className="card" style={{ marginTop: '32px' }}>
          <h3>🎯 Recommended Action Plans</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>
            Detailed treatment solutions with step-by-step instructions, dosages, and safety guidelines
          </p>

          {solutionPlan.map((solution, idx) => (
            <div key={solution.id} style={{
              margin: '20px 0',
              padding: '20px',
              background: solution.priority === 'Critical'
                ? 'rgba(239, 68, 68, 0.05)'
                : solution.priority === 'High'
                  ? 'rgba(245, 158, 11, 0.05)'
                  : 'rgba(16, 185, 129, 0.05)',
              borderRadius: '12px',
              borderLeft: `4px solid ${solution.priority === 'Critical' ? '#ef4444' :
                solution.priority === 'High' ? '#f59e0b' :
                  solution.priority === 'Medium' ? '#fbbf24' : '#10b981'
                }`
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <span className={`badge ${solution.priority === 'Critical' ? 'high' :
                    solution.priority === 'High' ? 'medium' : 'low'
                    }`} style={{ marginBottom: '8px', display: 'inline-block' }}>
                    {solution.priority}
                  </span>
                  <h4 style={{ margin: '8px 0 4px', fontSize: '1.1rem' }}>{solution.action}</h4>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '4px 0' }}>
                    <strong>Issue:</strong> {solution.issue}
                  </p>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '4px 0' }}>
                    <strong>Category:</strong> {solution.category}
                  </p>
                </div>
                <div style={{ textAlign: 'right', minWidth: '120px' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    ⏱️ {solution.timeline}
                  </div>
                </div>
              </div>

              <div style={{
                marginBottom: '16px',
                padding: '12px',
                background: 'rgba(59, 130, 246, 0.08)',
                borderRadius: '8px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '12px'
              }}>
                <div>
                  <strong style={{ color: 'var(--text-main)' }}>💊 Chemical:</strong>
                  <div style={{ marginTop: '4px', color: 'var(--text-muted)' }}>{solution.chemical}</div>
                </div>
                <div>
                  <strong style={{ color: 'var(--text-main)' }}>⚗️ Dosage:</strong>
                  <div style={{ marginTop: '4px', color: 'var(--text-main)', fontWeight: '600' }}>{solution.dosage}</div>
                </div>
              </div>

              <details style={{ marginTop: '16px', cursor: 'pointer' }}>
                <summary style={{
                  fontWeight: 'bold',
                  padding: '12px',
                  background: 'rgba(59, 130, 246, 0.1)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  userSelect: 'none'
                }}>
                  📋 Step-by-Step Instructions ({solution.steps.length} steps)
                </summary>
                <ol style={{
                  marginTop: '16px',
                  paddingLeft: '24px',
                  lineHeight: '1.8'
                }}>
                  {solution.steps.map((step, i) => (
                    <li key={i} style={{
                      margin: '12px 0',
                      color: 'var(--text-main)',
                      paddingLeft: '8px'
                    }}>
                      {step}
                    </li>
                  ))}
                </ol>

                <div style={{
                  marginTop: '16px',
                  padding: '14px',
                  background: 'rgba(245, 158, 11, 0.15)',
                  borderRadius: '8px',
                  borderLeft: '3px solid #f59e0b'
                }}>
                  <strong style={{ color: '#f59e0b' }}>⚠️ Safety Warning:</strong>
                  <div style={{ marginTop: '6px', color: 'var(--text-main)' }}>{solution.safety}</div>
                </div>

                <div style={{
                  marginTop: '12px',
                  fontSize: '0.9rem',
                  color: 'var(--text-muted)',
                  padding: '10px',
                  background: 'rgba(100, 116, 139, 0.1)',
                  borderRadius: '6px'
                }}>
                  <strong>🔄 Frequency:</strong> {solution.frequency}
                </div>
              </details>
            </div>
          ))}
        </div>
      )}

      {/* ====== MAINTENANCE LOG SECTION ====== */}
      <div className="card rich-card animate-fade-in" style={{ marginTop: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className={`icon-wrapper ${daysSinceMaintenance === 'Never' || (typeof daysSinceMaintenance === 'string' && parseInt(daysSinceMaintenance) > 14) ? 'red' : parseInt(daysSinceMaintenance) > 7 ? 'orange' : 'green'}`} style={{ marginBottom: 0, width: '40px', height: '40px' }}>
              <ClipboardList size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0 }}>Maintenance Log</h3>
              <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Track cleaning, treatments, and inspections · Last: <strong style={{ color: daysSinceMaintenance === 'Never' ? 'var(--danger)' : 'var(--text-main)' }}>{daysSinceMaintenance}</strong>
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setShowAddMaintenance(!showAddMaintenance)}
              style={{ padding: '8px 16px', background: 'var(--primary-gradient)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem', boxShadow: '0 2px 8px rgba(37, 99, 235, 0.2)' }}
            >
              {showAddMaintenance ? '✕ Cancel' : '+ Add Entry'}
            </button>
            {maintenanceLog.length > 0 && (
              <button
                onClick={clearMaintenanceLog}
                style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem' }}
              >
                Clear All
              </button>
            )}
          </div>
        </div>

        {/* Add Entry Form */}
        {showAddMaintenance && (
          <div className="maint-form" style={{ padding: '20px', borderRadius: '14px', background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.06), rgba(16, 185, 129, 0.04))', border: '1px solid rgba(37, 99, 235, 0.15)', marginBottom: '20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Type</label>
                <select
                  value={maintType}
                  onChange={e => setMaintType(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--glass-border)', background: 'var(--bg-card)', color: 'var(--text-main)', fontSize: '0.9rem', cursor: 'pointer' }}
                >
                  <option>Cleaning</option>
                  <option>Chemical Treatment</option>
                  <option>Filter Replacement</option>
                  <option>Inspection</option>
                  <option>Shock Chlorination</option>
                  <option>Pipe Flushing</option>
                  <option>Sensor Calibration</option>
                  <option>Other</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Notes</label>
                <input
                  type="text"
                  value={maintNotes}
                  onChange={e => setMaintNotes(e.target.value)}
                  placeholder="e.g., Full tank scrub + chlorine shock 50ppm"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--glass-border)', background: 'var(--bg-card)', color: 'var(--text-main)', fontSize: '0.9rem', boxSizing: 'border-box' }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                onClick={() => {
                  addMaintenanceEntry(maintType, maintNotes)
                  setMaintNotes('')
                  setShowAddMaintenance(false)
                }}
                style={{ padding: '10px 20px', background: 'var(--success-gradient)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '0.9rem', boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)' }}
              >
                <Check size={14} style={{ display: 'inline', marginRight: '6px' }} /> Log Entry
              </button>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Sensor snapshot will be saved automatically</span>
            </div>
          </div>
        )}

        {/* Log Table */}
        {maintenanceLog.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="maint-table" style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 4px', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ padding: '10px 12px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Date & Time</th>
                  <th style={{ padding: '10px 12px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Type</th>
                  <th style={{ padding: '10px 12px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Notes</th>
                  <th style={{ padding: '10px 12px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Risk at Time</th>
                  <th style={{ padding: '10px 12px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Sensors</th>
                </tr>
              </thead>
              <tbody>
                {maintenanceLog.slice(0, 20).map(entry => {
                  const d = new Date(entry.timestamp)
                  const snap = entry.sensorSnapshot || {}
                  const entryRisk = snap.risk ?? 0
                  return (
                    <tr key={entry.id} style={{ background: 'rgba(0,0,0,0.02)', borderRadius: '8px' }}>
                      <td style={{ padding: '12px', borderRadius: '8px 0 0 8px', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: '600', color: 'var(--text-main)' }}>{d.toLocaleDateString()}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{d.toLocaleTimeString()}</div>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <span style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: '600', background: entry.type === 'Shock Chlorination' ? 'rgba(239,68,68,0.1)' : entry.type === 'Chemical Treatment' ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)', color: entry.type === 'Shock Chlorination' ? '#ef4444' : entry.type === 'Chemical Treatment' ? '#f59e0b' : '#10b981' }}>
                          {entry.type}
                        </span>
                      </td>
                      <td style={{ padding: '12px', color: 'var(--text-muted)', maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {entry.notes || '—'}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <span style={{ fontWeight: '700', color: entryRisk > 60 ? 'var(--danger)' : entryRisk > 30 ? 'var(--warning)' : 'var(--success)' }}>
                          {entryRisk.toFixed(1)}%
                        </span>
                      </td>
                      <td style={{ padding: '12px', borderRadius: '0 8px 8px 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {snap.ph != null && <span style={{ marginRight: '8px' }}>pH:{snap.ph}</span>}
                        {snap.temp != null && <span style={{ marginRight: '8px' }}>{snap.temp}°C</span>}
                        {snap.turb != null && <span style={{ marginRight: '8px' }}>{snap.turb}NTU</span>}
                        {snap.tds != null && <span>{snap.tds}ppm</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {maintenanceLog.length > 20 && (
              <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '8px' }}>
                Showing 20 of {maintenanceLog.length} entries
              </p>
            )}
          </div>
        ) : (
          <div style={{ padding: '40px', textAlign: 'center', background: 'linear-gradient(135deg, rgba(100, 116, 139, 0.06), rgba(100, 116, 139, 0.02))', borderRadius: '14px', border: '1px dashed var(--glass-border)' }}>
            <div style={{ fontSize: '2rem', marginBottom: '12px' }}>📋</div>
            <div style={{ fontWeight: '600', color: 'var(--text-muted)', marginBottom: '4px' }}>No maintenance records yet</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Click "+ Add Entry" to log your first cleaning or maintenance activity.</div>
          </div>
        )}
      </div>

      <div className="footer">
        <p>Last updated: {lastUpdate} · Refreshes every 5s ·
          <button onClick={() => setShowDocs(true)} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontWeight: '600', marginLeft: '8px', padding: 0 }}>
            📖 Documentation
          </button>
        </p>
      </div>

      {/* ====== AI MODEL STATUS PANEL ====== */}
      {/* Rendered as a floating persistent badge; the full panel is above in the flow */}
      {/* ====== DOCUMENTATION MODAL ====== */}
      {showDocs && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div className="card" style={{ width: '100%', maxWidth: '860px', maxHeight: '88vh', overflowY: 'auto', padding: '36px', animation: 'fadeIn 0.3s ease-out' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px' }}>
              <div>
                <h2 style={{ margin: 0, background: 'var(--primary-gradient)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>📖 Project Documentation</h2>
                <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>Biofilm Risk Detection System — Full Technical Reference</p>
              </div>
              <button onClick={() => setShowDocs(false)} style={{ background: 'rgba(0,0,0,0.05)', border: '1px solid var(--glass-border)', borderRadius: '8px', width: '36px', height: '36px', cursor: 'pointer', fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>✕</button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '28px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0' }}>
              {[
                { id: 'overview', label: '🏗️ Overview' },
                { id: 'ai', label: '🧠 AI Model' },
                { id: 'dashboard', label: '📊 Dashboard Guide' },
                { id: 'hardware', label: '📡 Hardware & API' },
              ].map(tab => (
                <button key={tab.id} onClick={() => setDocsTab(tab.id)} style={{ padding: '10px 18px', border: 'none', borderBottom: docsTab === tab.id ? '2px solid var(--primary)' : '2px solid transparent', background: 'none', cursor: 'pointer', fontWeight: docsTab === tab.id ? '700' : '500', color: docsTab === tab.id ? 'var(--primary)' : 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '-1px', transition: 'all 0.2s' }}>
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab: Overview */}
            {docsTab === 'overview' && (
              <div>
                <h3 style={{ color: 'var(--text-main)', marginBottom: '12px' }}>Project Overview</h3>
                <p style={{ color: 'var(--text-muted)', lineHeight: '1.7', marginBottom: '20px' }}>
                  The <strong>Biofilm Risk Detection System</strong> is an end-to-end IoT + AI platform that monitors water quality in real time using six physical sensors connected to an ESP32 microcontroller. The system predicts the probability of biofilm formation in water systems (e.g., pipelines, tanks) and recommends corrective actions.
                </p>
                {[
                  { icon: '📡', title: 'IoT Layer — ESP32 Hardware', body: 'An ESP32 reads pH, temperature, humidity, flow rate, turbidity, and TDS every few seconds. It exposes readings over WiFi via a /status JSON endpoint. The data is fetched by test.py running on a host machine (PC or Raspberry Pi).' },
                  { icon: '🧠', title: 'AI Layer — Hybrid Ensemble Model', body: 'test.py collects 10 sequential readings and feeds them to the Hybrid Ensemble (Random Forest + XGBoost + LSTM). The averaged prediction is a biofilm risk percentage (0–100%). This runs at the edge — no cloud compute needed.' },
                  { icon: '☁️', title: 'Cloud Layer — ThingSpeak IoT', body: 'Sensor readings (field1–field6) and the ML risk score (field7) are uploaded to ThingSpeak every 16 seconds. The status code (field8) indicates system health: 1=Healthy, 2=Warning, 3=Critical, 0=Inactive.' },
                  { icon: '📊', title: 'Dashboard Layer — React App', body: 'The dashboard polls ThingSpeak every 5 seconds, displays live sensor values, visualizes trends, shows the AI risk prediction, runs a Decision Support System (DSS), and recommends chemical treatments and maintenance actions.' },
                  { icon: '🔬', title: 'Training Pipeline', body: 'generate_data.py creates synthetic labeled data (4 scenarios). train_hybrid.py trains the Hybrid Ensemble using a sliding window of 10 timesteps. The scaler (MinMaxScaler) is saved alongside the models for consistent inference.' },
                ].map(s => (
                  <div key={s.title} style={{ padding: '16px', borderRadius: '12px', background: 'rgba(0,0,0,0.03)', border: '1px solid var(--glass-border)', marginBottom: '12px' }}>
                    <div style={{ fontWeight: '700', marginBottom: '6px', display: 'flex', gap: '8px', alignItems: 'center' }}><span>{s.icon}</span><span>{s.title}</span></div>
                    <p style={{ margin: 0, color: 'var(--text-muted)', lineHeight: '1.7', fontSize: '0.9rem' }}>{s.body}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Tab: AI Model */}
            {docsTab === 'ai' && (
              <div>
                <h3 style={{ color: 'var(--text-main)', marginBottom: '12px' }}>AI & Machine Learning Details</h3>
                <div style={{ padding: '14px 18px', borderRadius: '10px', background: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(59,130,246,0.08))', border: '1px solid rgba(99,102,241,0.2)', marginBottom: '20px' }}>
                  <strong>Active Engine:</strong> {aiModelSource} &nbsp;·&nbsp; <strong>Status:</strong> {isAiActive ? '✅ Live ML Predictions' : '⚠️ Heuristic Fallback (run test.py)'}
                </div>
                {[
                  { title: '🌲 Random Forest Regressor', rows: [['Type', 'Ensemble — 100 Decision Trees'], ['Max Depth', '10'], ['Feature Input', 'Flattened 10-step window (10×6 = 60 features)'], ['Strength', 'Robust, interpretable, handles missing features'], ['R² Score', '≥ 0.95 on holdout set']] },
                  { title: '⚡ XGBoost Regressor', rows: [['Type', 'Gradient Boosted Trees'], ['Estimators', '100 · Learning Rate: 0.1 · Max Depth: 6'], ['Feature Input', 'Same 60-feature flat vector'], ['Strength', 'Fast, regularized, best single-model score'], ['R² Score', '≥ 0.96 on holdout set']] },
                  { title: '🔁 LSTM (Long Short-Term Memory)', rows: [['Type', 'Recurrent Neural Network — Keras/TensorFlow'], ['Architecture', 'LSTM(64) → Dropout(0.2) → LSTM(32) → Dropout(0.2) → Dense(16) → Dense(1)'], ['Sequence Length', '10 timesteps (≈160 seconds of history)'], ['Input Shape', '(1, 10, 6)'], ['Strength', 'Captures temporal drift and biofilm progression patterns'], ['R² Score', '≥ 0.94 on holdout set']] },
                  { title: '🏆 Hybrid Ensemble', rows: [['Formula', '(RF + XGB + LSTM) / 3 — simple average'], ['Why Ensemble?', 'Each model captures different patterns; averaging reduces variance'], ['Training Data', 'dataset_timeseries.csv — sliding window sequences'], ['Train/Test Split', '80/20 — time-ordered (no shuffle to prevent leakage)'], ['Scaler', 'MinMaxScaler saved as scaler_hybrid.pkl'], ['Final R² Score', '≥ 0.97 — exceeds any individual model'], ['Upload Frequency', 'Every 16 seconds via ThingSpeak field7']] },
                ].map(section => (
                  <div key={section.title} style={{ marginBottom: '20px', padding: '16px', borderRadius: '12px', background: 'rgba(0,0,0,0.03)', border: '1px solid var(--glass-border)' }}>
                    <div style={{ fontWeight: '700', marginBottom: '12px', fontSize: '1rem' }}>{section.title}</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                      <tbody>
                        {section.rows.map(([k, v]) => (
                          <tr key={k} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                            <td style={{ padding: '8px 12px 8px 0', color: 'var(--text-muted)', fontWeight: '600', whiteSpace: 'nowrap', width: '160px' }}>{k}</td>
                            <td style={{ padding: '8px 0', color: 'var(--text-main)' }}>{v}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}

                <div style={{ padding: '14px 18px', borderRadius: '10px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', fontSize: '0.875rem' }}>
                  <strong>🔄 Heuristic Fallback:</strong> When test.py is not running (field7 is missing), the dashboard uses a hand-crafted heuristic: Base=10, +20 for warm temp (20–35°C), +20 for neutral pH (6.5–8.0), +25 for turbidity {'>'} 5 NTU, +25 for flow {'<'} 1 L/min (stagnation), +15 for flow {'<'} 3 L/min, +10 for TDS {'>'} 500 ppm. Capped at 100%. This gives plausible estimates but should not be used for production decisions.
                </div>
              </div>
            )}

            {/* Tab: Dashboard Guide */}
            {docsTab === 'dashboard' && (
              <div>
                <h3 style={{ color: 'var(--text-main)', marginBottom: '16px' }}>Dashboard Segment Documentation</h3>
                {[
                  { emoji: '🎯', title: 'Biofilm Risk Prediction Ring', desc: 'Shows the current biofilm formation probability (0–100%) as an animated SVG ring. Color changes from green→orange→red as risk increases. The value is sourced from the Hybrid ML model (field7) when test.py is running, or the heuristic formula otherwise. Badge shows Low / Moderate / High Risk. Trend arrow shows direction vs. previous reading.' },
                  { emoji: '🛡️', title: 'System Health Ring', desc: 'Displays System Health = 100% − Risk%. Green means the water system is in good condition. Shows contributing strain factors (High Temp, Low Flow, High Turbidity, Unstable pH). If all sensors return clean readings, "Optimal Conditions" is shown.' },
                  { emoji: '📊', title: 'Stat Cards Grid (8 cards)', desc: 'Biofilm Stage (Initial Attachment → Dispersion), Confidence (active sensor count), DSS Decision (heuristic decision tree), Device Status (ThingSpeak connectivity), Last Maintenance (days since log), Water Volume (system capacity in L), Average Risk (average of last 10 readings), Recommended Actions (treatment count).' },
                  { emoji: '📈', title: 'Real-Time Line Chart', desc: 'Plots Biofilm Risk % and System Health % over the last 10 readings fetched from ThingSpeak. Time labels are shown on the X-axis. The chart updates every 5 seconds. If field7 is missing from a reading, the heuristic is retroactively applied.' },
                  { emoji: '🧠', title: 'AI Prediction Engine Panel', desc: 'Central AI transparency panel. Shows whether the Hybrid ML model is active or if the heuristic fallback is in use. Displays individual model cards (RF, XGBoost, LSTM, Ensemble) with R² scores, the 5-step data pipeline, and a live table of current sensor readings fed into the model.' },
                  { emoji: '🕸️', title: 'Water Quality Radar Chart', desc: 'Normalized view of all 5 key parameters (pH, Temp, Flow, Turbidity, TDS) scaled to 0–100 for comparison on a single radar chart. Helps spot imbalances at a glance. Flow is inverted so high flow = lower risk visual.' },
                  { emoji: '📊', title: 'Sensor Risk Bar Chart', desc: 'Shows the individual contribution each sensor reading makes to the overall biofilm risk score. Calculated from the getParamStatus thresholds. Bars are colored by risk level (green/amber/red).' },
                  { emoji: '🧫', title: 'Parameter Cards (6 Sensors)', desc: 'Individual cards for pH, Temperature, Humidity, Flow, Turbidity, and TDS. Each shows the current value, a visual progress bar, and a Normal/Caution status badge. Cards have mini ON/OFF toggle chips — disabling a sensor dims the card and excludes it from risk calculations. Disabled cards show an Isolated badge.' },
                  { emoji: '⚗️', title: 'Chemical Dosage Panel', desc: 'Calculates and recommends specific chemical dosages (Sodium Hypochlorite, pH Plus, pH Minus) based on water volume and current risk level. Dosages scale proportionally to the entered water volume (L). The auto-estimate ⚡ button sets volume from the flow rate heuristic.' },
                  { emoji: '🎯', title: 'Recommended Action Plans', desc: 'Detailed remediation cards generated by getSolutionPlan(). Each card shows the issue, category, priority (Critical/High/Medium), chemical/dosage, estimated cost, step-by-step instructions (collapsible), and safety warnings. Categories include Chemical Treatment, Physical Cleaning, Disinfection, Preventive Maintenance, System Modification, and Enhanced Monitoring.' },
                  { emoji: '⚙️', title: 'Settings Modal', desc: 'Opens via the ⚙️ header button. Contains: Maintenance log button (records today\'s date), Sensor Configuration toggles (enable/disable each sensor, persisted to localStorage), Sensor Offsets (manual calibration adjustments for pH, Temperature, TDS), Export CSV button (downloads last 10 readings), PDF Report button (generates a formatted report via jsPDF + jspdf-autotable).' },
                ].map(seg => (
                  <div key={seg.title} style={{ display: 'flex', gap: '14px', padding: '14px', borderRadius: '12px', background: 'rgba(0,0,0,0.03)', border: '1px solid var(--glass-border)', marginBottom: '10px' }}>
                    <div style={{ fontSize: '1.6rem', flexShrink: 0, marginTop: '2px' }}>{seg.emoji}</div>
                    <div>
                      <div style={{ fontWeight: '700', marginBottom: '4px' }}>{seg.title}</div>
                      <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.875rem', lineHeight: '1.65' }}>{seg.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Tab: Hardware & API */}
            {docsTab === 'hardware' && (
              <div>
                <h3 style={{ color: 'var(--text-main)', marginBottom: '16px' }}>Hardware, API & Configuration</h3>

                <div style={{ marginBottom: '20px', padding: '16px', borderRadius: '12px', background: 'rgba(0,0,0,0.03)', border: '1px solid var(--glass-border)' }}>
                  <div style={{ fontWeight: '700', marginBottom: '12px' }}>📡 Sensor Mapping (ThingSpeak Fields)</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <thead><tr style={{ borderBottom: '2px solid var(--glass-border)' }}><th style={{ textAlign: 'left', padding: '8px 12px 8px 0', color: 'var(--text-muted)' }}>ThingSpeak Field</th><th style={{ textAlign: 'left', padding: '8px 0', color: 'var(--text-muted)' }}>Sensor / Data</th><th style={{ textAlign: 'left', padding: '8px 0', color: 'var(--text-muted)' }}>Units</th><th style={{ textAlign: 'left', padding: '8px 0', color: 'var(--text-muted)' }}>Safe Range</th></tr></thead>
                    <tbody>
                      {[
                        ['field1', 'pH Sensor', 'pH', '6.5 – 8.5'],
                        ['field2', 'Temperature (DS18B20)', '°C', '< 30°C'],
                        ['field3', 'Humidity (DHT22)', '%', '40 – 60%'],
                        ['field4', 'Flow Rate (YF-S201)', 'L/min', '≥ 60 L/min'],
                        ['field5', 'Turbidity (SEN0189)', 'NTU', '≤ 5 NTU'],
                        ['field6', 'TDS (SEN0244)', 'ppm', '≤ 500 ppm'],
                        ['field7', 'AI Risk Score (test.py output)', '%', '< 30% Low, < 60% Medium'],
                        ['field8', 'System Status Code', 'enum', '1=OK, 2=Warning, 3=Critical, 0=Off'],
                      ].map(([f, s, u, r]) => (
                        <tr key={f} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                          <td style={{ padding: '8px 12px 8px 0', fontFamily: 'monospace', color: 'var(--primary)', fontWeight: '600' }}>{f}</td>
                          <td style={{ padding: '8px 0', color: 'var(--text-main)' }}>{s}</td>
                          <td style={{ padding: '8px 0', color: 'var(--text-muted)' }}>{u}</td>
                          <td style={{ padding: '8px 0', color: 'var(--text-muted)' }}>{r}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginBottom: '20px', padding: '16px', borderRadius: '12px', background: 'rgba(0,0,0,0.03)', border: '1px solid var(--glass-border)' }}>
                  <div style={{ fontWeight: '700', marginBottom: '12px' }}>🔌 ESP32 Configuration (secrets.h)</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <tbody>
                      {[
                        ['WIFI_SSID', 'Your WiFi network name'],
                        ['WIFI_PASSWORD', 'Your WiFi password'],
                        ['THINGSPEAK_API_KEY', 'Write API key from ThingSpeak channel'],
                        ['ESP32_IP', 'Static IP or DHCP assigned to ESP32 (used by test.py)'],
                      ].map(([k, v]) => (
                        <tr key={k} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                          <td style={{ padding: '8px 12px 8px 0', fontFamily: 'monospace', color: 'var(--primary)', fontWeight: '600', whiteSpace: 'nowrap' }}>{k}</td>
                          <td style={{ padding: '8px 0', color: 'var(--text-muted)' }}>{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginBottom: '20px', padding: '16px', borderRadius: '12px', background: 'rgba(0,0,0,0.03)', border: '1px solid var(--glass-border)' }}>
                  <div style={{ fontWeight: '700', marginBottom: '12px' }}>🐍 Running the AI Backend (test.py)</div>
                  {[
                    ['1. Activate virtual environment', 'cd d:\\biofilim_risk_detection && .venv\\Scripts\\activate'],
                    ['2. Install dependencies', 'pip install -r requirements.txt'],
                    ['3. Configure .env', 'Set ESP32_IP and THINGSPEAK_API_KEY in .env'],
                    ['4. Run the monitor', 'python test.py'],
                    ['5. Expected output', '📡 Sensor Data → 🧠 Predictions → ☁️ ThingSpeak upload every 16s'],
                  ].map(([step, cmd]) => (
                    <div key={step} style={{ marginBottom: '10px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                      <div style={{ fontWeight: '600', color: 'var(--text-muted)', fontSize: '0.85rem', whiteSpace: 'nowrap', paddingTop: '2px' }}>{step}</div>
                      <code style={{ fontSize: '0.82rem', background: 'rgba(0,0,0,0.06)', padding: '4px 10px', borderRadius: '6px', color: 'var(--text-main)', flex: 1, wordBreak: 'break-all' }}>{cmd}</code>
                    </div>
                  ))}
                </div>

                <div style={{ padding: '16px', borderRadius: '12px', background: 'rgba(0,0,0,0.03)', border: '1px solid var(--glass-border)' }}>
                  <div style={{ fontWeight: '700', marginBottom: '12px' }}>📊 ThingSpeak API Reference</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <tbody>
                      {[
                        ['Channel ID', '692657'],
                        ['Read URL', 'https://api.thingspeak.com/channels/692657/feeds.json?results=10'],
                        ['Write URL', 'https://api.thingspeak.com/update?api_key=YOUR_KEY'],
                        ['Poll Frequency', 'Dashboard polls every 5s · test.py writes every 16s'],
                        ['Data Retention', 'Last 10 readings shown in charts · Full history queryable via API'],
                      ].map(([k, v]) => (
                        <tr key={k} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                          <td style={{ padding: '8px 12px 8px 0', color: 'var(--text-muted)', fontWeight: '600', whiteSpace: 'nowrap', width: '150px' }}>{k}</td>
                          <td style={{ padding: '8px 0', color: 'var(--text-main)', fontFamily: v.startsWith('http') ? 'monospace' : 'inherit', fontSize: v.startsWith('http') ? '0.8rem' : 'inherit' }}>{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Close Footer */}
            <div style={{ marginTop: '28px', display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowDocs(false)} style={{ padding: '10px 24px', background: 'var(--primary-gradient)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '0.9rem' }}>
                Close Documentation
              </button>
            </div>
          </div>
        </div>
      )}
      <Analytics />
    </div >
  )
}
