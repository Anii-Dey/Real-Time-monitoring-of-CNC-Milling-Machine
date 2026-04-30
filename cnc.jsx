import {
  Activity,
  AlertCircle,
  Cpu,
  Download,
  Gauge,
  LayoutDashboard,
  LayoutGrid,
  Link,
  Play,
  Radio,
  Square,
  Thermometer,
  Weight,
  Zap
} from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis, YAxis
} from 'recharts';

const SidebarItem = memo(({ id, icon: Icon, label, activeTab, onClick }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all ${activeTab === id
      ? 'bg-blue-600/20 text-blue-400 border-l-4 border-blue-500'
      : 'text-slate-400 hover:bg-slate-800 hover:text-white'
      }`}
  >
    <Icon size={20} />
    <span className="font-medium">{label}</span>
  </button>
));

const GraphBlock = memo(({ title, dataKey, color, unit, domain, isLarge, history }) => (
  <div className={`bg-slate-950/80 border border-slate-800/90 rounded-[1.5rem] p-6 shadow-2xl shadow-slate-950/20 ${isLarge ? 'mb-8' : ''}`}>
    <h3 className="text-white font-bold text-sm mb-4 flex items-center uppercase tracking-wider">
      <Activity size={16} className="mr-2" style={{ color }} /> {title} ({unit})
    </h3>
    <div className={isLarge ? "h-[450px]" : "h-[220px]"}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={history}>
          <defs>
            <linearGradient id={`color${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="2 2" stroke="#2d3748" vertical={false} />
          <XAxis
            dataKey="time"
            stroke="#475569"
            fontSize={10}
            hide={!isLarge}
            axisLine={true}
            tickLine={false}
            minTickGap={16}
          />
          <YAxis
            stroke="#475569"
            fontSize={10}
            domain={domain}
            tickCount={6}
            axisLine={true}
            tickLine={false}
          />
          <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155' }} />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            fillOpacity={1}
            fill={`url(#color${dataKey})`}
            strokeWidth={2}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  </div>
));

const App = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isStarted, setIsStarted] = useState(false);
  const [status, setStatus] = useState('IDLE');
  const [seconds, setSeconds] = useState(0);
  const [history, setHistory] = useState([]);
  const [sessionData, setSessionData] = useState([]);
  const [isSerialConnected, setIsSerialConnected] = useState(false);
  const [baudRate, setBaudRate] = useState(9600);
  const [rawSerialLine, setRawSerialLine] = useState('');
  const [validLineCount, setValidLineCount] = useState(0);
  const [invalidLineCount, setInvalidLineCount] = useState(0);
  const [lastDataTimestamp, setLastDataTimestamp] = useState(0);
  const [saveMessage, setSaveMessage] = useState('');

  const timerRef = useRef(null);
  const portRef = useRef(null);
  const lineBufferRef = useRef("");
  const rawSerialLineRef = useRef('');
  const validLineCountRef = useRef(0);
  const invalidLineCountRef = useRef(0);
  const lastDataTimestampRef = useRef(0);
  const lastUiUpdateRef = useRef(0);
  const recordingRef = useRef(false);
  const lastDisplayRef = useRef({ temp: 0, rpm: 0, vibTotal: 0, force: 0 });
  const smoothingBuffersRef = useRef({ temp: [], rpm: [], vibTotal: [], force: [] });
  const pendingHistoryRef = useRef([]);
  const updateScheduledRef = useRef(false);
  const UI_THROTTLE_MS = 180;
  const SMOOTHING_WINDOW = 6;
  const SMOOTHING_ALPHA = 0.08;

  const formatTime = (totalSeconds) => {
    const hrs = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
    const mins = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
    const secs = (totalSeconds % 60).toString().padStart(2, '0');
    return `${hrs}:${mins}:${secs}`;
  };

  // --- ARDUINO SERIAL LOGIC ---
  const connectSerial = async () => {
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate });
      portRef.current = port;
      setIsSerialConnected(true);
      setStatus('CONNECTED');
      readSerialData();
    } catch (err) {
      console.error("Serial Connection Failed:", err);
    }
  };

  const flushSerialState = () => {
    setRawSerialLine(rawSerialLineRef.current);
    setValidLineCount(validLineCountRef.current);
    setInvalidLineCount(invalidLineCountRef.current);
    setLastDataTimestamp(lastDataTimestampRef.current);
    lastUiUpdateRef.current = Date.now();
  };

  const readSerialData = async () => {
    const textStream = portRef.current.readable.pipeThrough(new TextDecoderStream());
    const reader = textStream.getReader();

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        lineBufferRef.current += value;
        const lines = lineBufferRef.current.split('\n');
        lineBufferRef.current = lines.pop();

        for (let line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          rawSerialLineRef.current = trimmedLine;
          const parsedData = parseSensorLine(trimmedLine);
          if (!parsedData) {
            invalidLineCountRef.current += 1;
          } else {
            validLineCountRef.current += 1;
            processNewData(parsedData);
          }
          lastDataTimestampRef.current = Date.now();

          const now = Date.now();
          if (now - lastUiUpdateRef.current >= UI_THROTTLE_MS) {
            flushSerialState();
          }
        }
      }
    } catch (err) {
      console.error("Read Error:", err);
      setIsSerialConnected(false);
    } finally {
      reader.releaseLock();
    }
  };
  //const SMOOTHING_FACTOR = 0.3;

  const flushPendingHistory = () => {
    const pending = pendingHistoryRef.current;
    if (pending.length === 0) {
      updateScheduledRef.current = false;
      return;
    }

    setHistory(prev => {
      const combined = [...prev, ...pending];
      return combined.length > 120 ? combined.slice(combined.length - 120) : combined;
    });

    if (recordingRef.current) {
      setSessionData(prev => [...prev, ...pending]);
    }

    pendingHistoryRef.current = [];
    updateScheduledRef.current = false;
  };

  const processNewData = (data) => {
    const now = new Date();
    const previousDisplay = lastDisplayRef.current;
    const target = averageSensorBuffer(data);

    const display = smoothSensorData(target, previousDisplay);
    lastDisplayRef.current = display;

    const newDataPoint = {
      row: data.row,
      timeMs: data.timeMs,
      temp: display.temp,
      rpm: display.rpm,
      vibX: data.vibX,
      vibY: data.vibY,
      vibZ: data.vibZ,
      vibTotal: display.vibTotal,
      force: display.force,
      timestamp: now.toISOString(),
      time: now.toLocaleTimeString().split(' ')[0],
      rawTemp: data.rawTemp,
      rawRpm: data.rawRpm,
      rawForce: data.rawForce,
      rawVibTotal: data.rawVibTotal
    };

    pendingHistoryRef.current.push(newDataPoint);
    if (!updateScheduledRef.current) {
      updateScheduledRef.current = true;
      requestAnimationFrame(flushPendingHistory);
    }
  };

  const clampValue = (value, min, max) => Math.min(max, Math.max(min, value));

  const averageSensorBuffer = (data) => {
    const buffers = smoothingBuffersRef.current;
    const pushAndTrim = (key, value) => {
      const buffer = buffers[key];
      buffer.push(value);
      if (buffer.length > SMOOTHING_WINDOW) buffer.shift();
      return buffer.reduce((sum, item) => sum + item, 0) / buffer.length;
    };

    return {
      temp: pushAndTrim('temp', data.rawTemp),
      rpm: pushAndTrim('rpm', data.rawRpm),
      vibTotal: pushAndTrim('vibTotal', data.rawVibTotal),
      force: pushAndTrim('force', data.rawForce)
    };
  };

  const smoothSensorData = (data, previous) => {
    if (!previous || Object.keys(previous).length === 0) {
      return {
        temp: data.temp,
        rpm: data.rpm,
        vibTotal: data.vibTotal,
        force: data.force
      };
    }

    const smooth = (next, prev) => prev + (next - prev) * SMOOTHING_ALPHA;
    return {
      temp: smooth(data.temp, previous.temp),
      rpm: smooth(data.rpm, previous.rpm),
      vibTotal: smooth(data.vibTotal, previous.vibTotal),
      force: smooth(data.force, previous.force)
    };
  };

  const parseSensorLine = (line) => {
    const cleaned = line.trim().replace(/\r/g, '');
    if (!cleaned) return null;

    const parts = cleaned.split(',').map(part => part.trim());
    if (parts.length !== 9) return null;
    if (/^[a-zA-Z]/.test(parts[0])) return null;

    const [rowStr, timeStr, tempStr, vibXStr, vibYStr, vibZStr, vibTotalStr, forceStr, rpmStr] = parts;
    const row = Number(rowStr);
    const timeMs = Number(timeStr);
    const rawTemp = Number(tempStr);
    const vibX = Number(vibXStr);
    const vibY = Number(vibYStr);
    const vibZ = Number(vibZStr);
    const rawVibTotal = Number(vibTotalStr);
    const rawForce = Number(forceStr);
    const rawRpm = Number(rpmStr);

    if (![row, timeMs, rawTemp, vibX, vibY, vibZ, rawVibTotal, rawForce, rawRpm].every(Number.isFinite)) {
      return null;
    }

    return {
      row,
      timeMs,
      rawTemp: clampValue(rawTemp, -50, 250),
      vibX: clampValue(vibX, -100, 100),
      vibY: clampValue(vibY, -100, 100),
      vibZ: clampValue(vibZ, -100, 100),
      rawVibTotal: clampValue(rawVibTotal, 0, 500),
      rawForce: clampValue(rawForce, 0, 2000),
      rawRpm: clampValue(rawRpm, 0, 20000)
    };
  };

  // Removed the Simulation Fallback useEffect entirely.

  // Timer logic for Machining Time
  useEffect(() => {
    if (isStarted) {
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isStarted]);

  const handleStart = () => {
    recordingRef.current = true;
    setIsStarted(true);
    setStatus('RUNNING');
    setSessionData([]);
    setSeconds(0);
  };

  const handleStop = async () => {
    flushPendingHistory();
    const allSessionData = [...sessionData, ...pendingHistoryRef.current];
    recordingRef.current = false;
    setIsStarted(false);
    setStatus('STOPPED');
    if (allSessionData.length > 0) {
      const success = await exportToCSV(allSessionData);
      setSaveMessage(success ? 'CSV saved successfully.' : 'CSV save canceled or failed.');
    }
  };

  const handleSaveCSV = async () => {
    const allSessionData = [...sessionData, ...pendingHistoryRef.current];
    if (allSessionData.length === 0) {
      setSaveMessage('No session data to save.');
      return;
    }
    const success = await exportToCSV(allSessionData);
    setSaveMessage(success ? 'CSV saved successfully.' : 'CSV save canceled or failed.');
  };

  useEffect(() => {
    if (!saveMessage) return;
    const timer = setTimeout(() => setSaveMessage(''), 3000);
    return () => clearTimeout(timer);
  }, [saveMessage]);

  const saveFileWithPicker = async (fileName, content) => {
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [
            {
              description: 'CSV file',
              accept: { 'text/csv': ['.csv'] }
            }
          ]
        });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        return true;
      } catch (error) {
        console.warn('Save picker canceled or failed:', error);
        return false;
      }
    }

    return false;
  };

  const exportToCSV = async (data) => {
    const headers = "Row,Time_ms,Temp_C,Vib_X,Vib_Y,Vib_Z,Vib_Total,Force_g,RPM\n";
    const rows = data.map(d => `${d.row},${d.timeMs},${d.rawTemp},${d.vibX},${d.vibY},${d.vibZ},${d.rawVibTotal},${d.rawForce},${d.rawRpm}`).join("\n");
    const csvContent = headers + rows;
    const fileName = `CNC_LOG_${new Date().getTime()}.csv`;

    const saved = await saveFileWithPicker(fileName, csvContent);
    if (saved) {
      return true;
    }

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    return true;
  };


  const last = history[history.length - 1] || { temp: 0, rpm: 0, vibTotal: 0, force: 0, timeMs: 0 };
  const isDataStale = isStarted && isSerialConnected && (Date.now() - lastDataTimestamp > 3000);

  return (
    <div className="flex h-screen overflow-hidden font-sans text-slate-200 bg-[#06090f] bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.2),_transparent_20%),radial-gradient(circle_at_bottom_right,_rgba(168,85,247,0.18),_transparent_18%),linear-gradient(180deg,_#06090f_0%,_#08101a_100%)]">
      {/* Sidebar */}
      <aside className="w-72 border-r border-slate-800 flex flex-col bg-slate-950/85 backdrop-blur-xl shadow-2xl shadow-slate-950/20 z-20">
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="bg-blue-600 p-2 rounded-lg"><Cpu className="text-white" size={24} /></div>
            <h1 className="text-lg font-bold text-white tracking-tight">CNC MONITOR</h1>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <SidebarItem id="dashboard" icon={LayoutDashboard} label="Dashboard" activeTab={activeTab} onClick={() => setActiveTab('dashboard')} />
          <SidebarItem id="monitoring" icon={Activity} label="Live Monitoring" activeTab={activeTab} onClick={() => setActiveTab('monitoring')} />
          <SidebarItem id="all_graphs" icon={LayoutGrid} label="All Graphs" activeTab={activeTab} onClick={() => setActiveTab('all_graphs')} />
        </nav>

        <div className="p-4 border-t border-slate-800 bg-slate-900/10 space-y-3">
          <div className="space-y-3">
            <label className="block text-[10px] uppercase tracking-[0.24em] text-slate-400">Baud Rate</label>
            <select
              value={baudRate}
              onChange={e => setBaudRate(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2 px-3 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
            >
              {[9600, 19200, 38400, 57600, 115200].map(rate => (
                <option key={rate} value={rate}>{rate}</option>
              ))}
            </select>
          </div>

          <button onClick={connectSerial} className={`w-full flex items-center justify-center space-x-2 py-2 rounded-lg border transition-all ${isSerialConnected ? 'border-emerald-500 text-emerald-500 bg-emerald-500/5' : 'border-blue-500 text-blue-500 hover:bg-blue-500/10'}`}>
            <Link size={16} />
            <span className="font-bold text-xs">{isSerialConnected ? 'Arduino Connected' : 'Connect Arduino'}</span>
          </button>

          <button onClick={handleStart} disabled={isStarted || !isSerialConnected} className={`w-full flex items-center justify-center space-x-2 py-3 rounded-lg font-bold ${isStarted ? 'bg-slate-800 text-slate-500' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'}`}>
            <Play size={18} fill="currentColor" /> <span>Start Machine</span>
          </button>
          <button onClick={handleStop} disabled={!isStarted} className={`w-full flex items-center justify-center space-x-2 py-3 rounded-lg font-bold ${!isStarted ? 'bg-slate-800 text-slate-500' : 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-500/20'}`}>
            <Square size={18} fill="currentColor" /> <span>Stop Machine</span>
          </button>
          <button onClick={handleSaveCSV} disabled={sessionData.length === 0} className={`w-full flex items-center justify-center space-x-2 py-3 rounded-lg font-bold ${sessionData.length === 0 ? 'bg-slate-800 text-slate-500' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20'}`}>
            <Download size={18} fill="currentColor" /> <span>Save CSV</span>
          </button>

          <div className="bg-black/40 rounded-lg p-3 text-center border border-slate-800">
            <div className="text-2xl font-mono text-blue-400 font-bold tracking-widest">{formatTime(seconds)}</div>
            <p className="text-[10px] text-slate-500 uppercase mt-1">Machining Time</p>
          </div>

          <div className="bg-slate-900/80 rounded-xl p-4 text-xs text-slate-400 border border-slate-800 space-y-2">
            <div className="flex justify-between"><span>Raw line</span><span className="text-slate-200">{rawSerialLine || 'waiting...'}</span></div>
            <div className="flex justify-between"><span>Valid</span><span className="text-emerald-400">{validLineCount}</span></div>
            <div className="flex justify-between"><span>Invalid</span><span className="text-amber-400">{invalidLineCount}</span></div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-[#06090f]/60 custom-scrollbar">
        <header className="sticky top-0 bg-slate-950/85 backdrop-blur-xl z-10 px-8 py-6 border-b border-slate-800 flex justify-between items-center">
          <div className="flex items-center space-x-6">
            <div>
              <h2 className="text-2xl font-bold text-white capitalize">{activeTab.replace('_', ' ')}</h2>
              <p className="text-xs text-slate-400 mt-1">Status: <span className={isStarted ? 'text-emerald-400' : 'text-red-400'}>{status}</span></p>
            </div>
            {saveMessage && (
              <div className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 text-emerald-300 text-[11px] font-semibold">{saveMessage}</div>
            )}
            {isDataStale && (
              <div className="flex items-center space-x-2 bg-amber-500/10 border border-amber-500/20 px-3 py-1 rounded text-amber-500 animate-pulse">
                <AlertCircle size={14} />
                <span className="text-[10px] font-bold uppercase">No Recent Data from Arduino</span>
              </div>
            )}
          </div>
          <div className="bg-slate-900 border border-slate-800 px-4 py-2 rounded-lg text-slate-300 font-mono text-sm">
            {new Date().toLocaleTimeString()}
          </div>
        </header>

        <div className="p-8">
          {(!isSerialConnected && isStarted) && (
            <div className="mb-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-center space-x-4">
              <div className="p-2 bg-blue-500 rounded-lg"><Link size={20} className="text-white" /></div>
              <div>
                <h4 className="text-white font-bold text-sm">Waiting for Connection</h4>
                <p className="text-slate-400 text-xs">The machine is "Started", but you haven't connected the Arduino Serial yet. Click "Connect Arduino" in the sidebar.</p>
              </div>
            </div>
          )}

          {activeTab === 'dashboard' && (
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8 animate-in fade-in duration-500">
              <div className="bg-[#1a1f2e] p-5 rounded-xl border border-slate-800 hover:border-red-500/50 transition-colors">
                <Thermometer className="text-red-500 mb-2" size={20} />
                <p className="text-slate-500 text-xs font-bold uppercase">Temp</p>
                <p className="text-2xl font-bold text-white">{last.temp.toFixed(1)}°C</p>
              </div>
              <div className="bg-[#1a1f2e] p-5 rounded-xl border border-slate-800 hover:border-emerald-500/50 transition-colors">
                <Gauge className="text-emerald-500 mb-2" size={20} />
                <p className="text-slate-500 text-xs font-bold uppercase">RPM</p>
                <p className="text-2xl font-bold text-white">{last.rpm.toFixed(0)}</p>
              </div>
              <div className="bg-[#1a1f2e] p-5 rounded-xl border border-slate-800 hover:border-amber-500/50 transition-colors">
                <Radio className="text-amber-500 mb-2" size={20} />
                <p className="text-slate-500 text-xs font-bold uppercase">Vibration</p>
                <p className="text-2xl font-bold text-white">{last.vibTotal.toFixed(2)}</p>
              </div>
              <div className="bg-[#1a1f2e] p-5 rounded-xl border border-slate-800 hover:border-blue-500/50 transition-colors">
                <Zap className="text-blue-500 mb-2" size={20} />
                <p className="text-slate-500 text-xs font-bold uppercase">Force</p>
                <p className="text-2xl font-bold text-white">{last.force.toFixed(2)} g</p>
              </div>
              <div className="bg-[#1a1f2e] p-5 rounded-xl border border-slate-800 hover:border-purple-500/50 transition-colors">
                <Weight className="text-purple-500 mb-2" size={20} />
                <p className="text-slate-500 text-xs font-bold uppercase">Time</p>
                <p className="text-2xl font-bold text-white">{last.timeMs} ms</p>
              </div>
            </div>
          )}

          {activeTab === 'monitoring' && (
            <div className="space-y-4 animate-in slide-in-from-bottom-4 duration-500">
              <GraphBlock history={history} title="Temperature" dataKey="temp" color="#ef4444" unit="°C" domain={[0, 250]} isLarge />
              <GraphBlock history={history} title="RPM" dataKey="rpm" color="#10b981" unit="RPM" domain={[0, 12000]} isLarge />
              <GraphBlock history={history} title="Vibration Total" dataKey="vibTotal" color="#f59e0b" unit="g" domain={[0, 200]} isLarge />
              <GraphBlock history={history} title="Force" dataKey="force" color="#3b82f6" unit="g" domain={[0, 2000]} isLarge />
            </div>
          )}

          {activeTab === 'all_graphs' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in zoom-in-95 duration-300">
              <GraphBlock history={history} title="Temperature" dataKey="temp" color="#ef4444" unit="°C" domain={[0, 250]} />
              <GraphBlock history={history} title="RPM" dataKey="rpm" color="#10b981" unit="RPM" domain={[0, 12000]} />
              <GraphBlock history={history} title="Vibration Total" dataKey="vibTotal" color="#f59e0b" unit="g" domain={[0, 200]} />
              <GraphBlock history={history} title="Force" dataKey="force" color="#3b82f6" unit="g" domain={[0, 2000]} />
              <div className="lg:col-span-2">
                <GraphBlock history={history} title="Raw Time (ms)" dataKey="timeMs" color="#a855f7" unit="ms" domain={[0, 'dataMax']} />
              </div>
            </div>
          )}
        </div>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
      `}</style>
    </div>
  );
};

export default App;