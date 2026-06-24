import React, { useState, useEffect, useRef, Component, ErrorInfo, ReactNode } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  FlatList,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import QRCode from 'react-native-qrcode-svg';
import { io, Socket } from 'socket.io-client';
import notifee, { AndroidImportance } from '@notifee/react-native';
import CallScreen from './CallScreen';

// ---- Types ----
export interface Activity {
  type: 'reply' | 'ignore' | 'voice' | 'system';
  priority?: 'Low' | 'Medium' | 'High';
  title: string;
  message: string;
  replyText?: string;
  time: string;
  contact?: string;
  number?: string;
}

interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'luna';
  time: string;
}

// ---- Error Boundary ----
interface ErrorBoundaryState { hasError: boolean; error: string; errorInfo: string; }

class ErrorBoundary extends Component<{children: ReactNode}, ErrorBoundaryState> {
  constructor(props: {children: ReactNode}) {
    super(props);
    this.state = { hasError: false, error: '', errorInfo: '' };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.toString() };
  }
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ error: error.toString(), errorInfo: errorInfo.componentStack || '' });
  }
  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={{ flex: 1, backgroundColor: '#0d0d0d', padding: 20 }}>
          <Text style={{ color: '#ff4444', fontSize: 20, fontWeight: 'bold', marginBottom: 10 }}>⚠ App Crashed</Text>
          <ScrollView>
            <Text selectable style={{ color: '#ff8888', fontSize: 14, fontFamily: 'monospace' }}>{this.state.error}</Text>
            <Text selectable style={{ color: '#ffaaaa', fontSize: 12, fontFamily: 'monospace', marginTop: 10 }}>{this.state.errorInfo}</Text>
          </ScrollView>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

// ---- Theme Colors ----
const C = {
  bg: '#0a0e1a',
  card: '#141828',
  cardBorder: '#1e2440',
  accent: '#6c5ce7',
  accentLight: '#a29bfe',
  green: '#00b894',
  greenDark: '#00a381',
  red: '#e17055',
  orange: '#fdcb6e',
  text: '#f0f0f5',
  textDim: '#8a8ea8',
  textMuted: '#50546e',
  inputBg: '#1a1f35',
  inputBorder: '#2a3050',
};

const DEFAULT_PROMPT = `You are Luna, the personal and highly capable WhatsApp assistant to Sufiyan.
Your role is to manage his incoming messages, schedule, and communications like a real human assistant.

PERSONALITY:
- Warm, polite, and deeply professional.
- Speak conversationally, exactly like a human assistant texting on WhatsApp. No robotic formatting.
- Keep replies short and natural (1-3 sentences).
- You are highly protective of Sufiyan's time.
- You understand and speak Hindi written in English (Hinglish).

KEY RULES:
1. Introduce yourself gracefully if they don't know who you are.
2. Your goal is to take the message. Once you know WHAT they want, tell them you'll notify Sufiyan.
3. DO NOT stall or say "give me a minute to check". You cannot talk to Sufiyan in real-time.
4. DO NOT say "I just checked with him" (that is a lie).
5. Once you have taken the message, politely end the conversation.
6. For family and close friends, be warm and personal.
7. SPECIAL RULE FOR GIRLFRIEND: If the contact is labeled as 'Girlfriend', drop your assistant persona completely! Act like her fun, caring, and gossipy best friend. Ask about her day, use emojis, and chat casually. Do not act like a secretary with her.`;

let socketRef: Socket | null = null;

// ---- Tab Icon Components ----
const TabIcon = ({ name, active }: { name: string; active: boolean }) => {
  const icons: Record<string, string> = {
    dashboard: '🏠',
    inbox: '📥',
    chat: '💬',
    settings: '⚙️',
    logs: '📋',
  };
  return <Text style={{ fontSize: 16, marginBottom: 2 }}>{icons[name] || '📄'}</Text>;
};

function LunaApp() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [status, setStatus] = useState('Disconnected');
  const [logs, setLogs] = useState<string[]>([]);
  const [qrCode, setQrCode] = useState('');
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isPaused, setIsPaused] = useState(false);

  // Chat with Luna
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isLunaTyping, setIsLunaTyping] = useState(false);
  
  // Voice Call
  const [isCalling, setIsCalling] = useState(false);
  const [callData, setCallData] = useState({ name: '', reason: '' });
  const [backendUrl, setBackendUrl] = useState('');
  const [nvidiaApiKey, setNvidiaApiKey] = useState('');
  const [groqApiKey, setGroqApiKey] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_PROMPT);
  const [excludedNumbers, setExcludedNumbers] = useState('');
  const [relationships, setRelationships] = useState('');
  
  const scrollViewRef = useRef<ScrollView>(null);
  const chatScrollRef = useRef<ScrollView>(null);
  const logsRef = useRef<string[]>([]);
  const activitiesRef = useRef<Activity[]>([]);
  const chatMessagesRef = useRef<ChatMessage[]>([]);

  const addLog = (msg: string) => {
    const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logsRef.current = [...logsRef.current.slice(-99), entry];
    setLogs([...logsRef.current]);
  };

  const addActivity = (act: Activity) => {
    activitiesRef.current = [act, ...activitiesRef.current].slice(0, 50);
    setActivities([...activitiesRef.current]);
  };

  const addChatMessage = (msg: ChatMessage) => {
    chatMessagesRef.current = [...chatMessagesRef.current, msg];
    setChatMessages([...chatMessagesRef.current]);
    setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const displayNotification = async (title: string, body: string) => {
    try {
      await notifee.requestPermission();
      const channelId = await notifee.createChannel({
        id: 'luna_alerts',
        name: 'Luna Alerts',
        importance: AndroidImportance.HIGH,
      });
      await notifee.displayNotification({
        title,
        body,
        android: {
          channelId,
          smallIcon: 'ic_launcher',
          pressAction: { id: 'default' },
        },
      });
    } catch (e) {
      addLog(`Notification error: ${(e as Error).message}`);
    }
  };

  useEffect(() => {
    addLog('Luna App started.');
    
    const loadSettings = async () => {
      try {
        const url = await AsyncStorage.getItem('backendUrl');
        const key = await AsyncStorage.getItem('nvidiaApiKey');
        const groqKey = await AsyncStorage.getItem('groqApiKey');
        const prompt = await AsyncStorage.getItem('systemPrompt');
        const excluded = await AsyncStorage.getItem('excludedNumbers');
        const rels = await AsyncStorage.getItem('relationships');
        
        if (url) {
          setBackendUrl(url);
          connectToServer(url);
        } else {
          addLog('Please enter your Backend URL in Settings.');
          setStatus('Requires Setup');
        }
        
        if (key) setNvidiaApiKey(key);
        if (groqKey) setGroqApiKey(groqKey);
        if (prompt) setSystemPrompt(prompt);
        if (excluded) setExcludedNumbers(excluded);
        if (rels) setRelationships(rels);
      } catch(e) {
        addLog('Could not load settings.');
      }
    };
    
    loadSettings();

    return () => {
      if (socketRef) {
        socketRef.disconnect();
      }
    };
  }, []);

  const parseRelationships = (relStr: string): Record<string, string> => {
    const map: Record<string, string> = {};
    relStr.split(',').forEach(pair => {
      const [num, label] = pair.split('=').map(s => s.trim());
      if (num && label) map[num] = label;
    });
    return map;
  };

  const connectToServer = (url: string) => {
    if (socketRef) {
      socketRef.disconnect();
    }
    
    if (!url) return;

    addLog(`Connecting to ${url}...`);
    setStatus('Connecting...');
    
    const socket = io(url, {
      transports: ['websocket'],
    });
    
    socketRef = socket;

    socket.on('connect', () => {
      addLog('Connected to backend!');
      setStatus('Connected ✅');
    });

    socket.on('disconnect', () => {
      addLog('Disconnected from server.');
      setStatus('Disconnected');
    });

    socket.on('connect_error', (err) => {
      addLog(`Connection error: ${err.message}`);
      setStatus('Connection Error');
    });

    socket.on('backend_ready', () => {
      addLog('Backend is ready.');
      sendConfig(socket, nvidiaApiKey, groqApiKey, systemPrompt, excludedNumbers, relationships);
    });

    socket.on('log', (msg) => {
      addLog(msg);
    });

    socket.on('qr', (data) => {
      setQrCode(data);
      setStatus('Scan QR Code');
    });

    socket.on('status', (botStatus) => {
      if (botStatus === 'connected') {
        setStatus('Luna Online 🟢');
        setQrCode('');
      } else if (botStatus === 'disconnected') {
        setStatus('Bot Disconnected');
      } else if (botStatus === 'logged_out') {
        setStatus('Bot Logged Out');
        setQrCode('');
      }
    });

    socket.on('incoming_call', (data) => {
      addLog(`Incoming call from ${data.contact}...`);
      setCallData({ name: data.contact, reason: data.reason });
      setIsCalling(true);
      displayNotification('🚨 Luna Emergency Call', `Incoming call regarding ${data.contact}`);
    });

    socket.on('activity', (act: Activity) => {
      addActivity(act);
      if (act.priority === 'High' || act.type === 'voice') {
        displayNotification(act.title, act.message);
      }
    });

    socket.on('luna_reply', (data: { text: string }) => {
      setIsLunaTyping(false);
      addChatMessage({
        id: Date.now().toString(),
        text: data.text,
        sender: 'luna',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    });
  };

  const sendConfig = (socket: Socket | null, key: string, groqKey: string, prompt: string, excluded: string, rels: string) => {
    if (!socket || !socket.connected) return;
    const excludeArr = excluded.split(',').map(n => n.trim()).filter(n => n);
    socket.emit('config', {
      nvidiaApiKey: key,
      groqApiKey: groqKey,
      systemPrompt: prompt,
      excludedNumbers: excludeArr,
      isPaused,
      relationships: parseRelationships(rels),
    });
  };

  const saveSettings = async () => {
    try {
      await AsyncStorage.setItem('backendUrl', backendUrl);
      await AsyncStorage.setItem('nvidiaApiKey', nvidiaApiKey);
      await AsyncStorage.setItem('groqApiKey', groqApiKey);
      await AsyncStorage.setItem('systemPrompt', systemPrompt);
      await AsyncStorage.setItem('excludedNumbers', excludedNumbers);
      await AsyncStorage.setItem('relationships', relationships);
      addLog('Settings saved.');
      
      connectToServer(backendUrl);
      sendConfig(socketRef, nvidiaApiKey, groqApiKey, systemPrompt, excludedNumbers, relationships);
    } catch (e: any) {
      addLog('Save failed: ' + e.message);
    }
  };

  const startBot = () => {
    if (!socketRef || !socketRef.connected) {
      addLog('Cannot start: Not connected to backend.');
      return;
    }
    sendConfig(socketRef, nvidiaApiKey, groqApiKey, systemPrompt, excludedNumbers, relationships);
    addLog('Requesting bot start...');
    socketRef.emit('start');
  };

  const stopBot = () => {
    if (!socketRef || !socketRef.connected) return;
    addLog('Requesting bot logout...');
    socketRef.emit('logout');
  };

  const sendChatMessage = () => {
    if (!chatInput.trim()) return;
    if (!socketRef || !socketRef.connected) {
      addChatMessage({
        id: Date.now().toString(),
        text: 'Not connected to server. Please check Settings.',
        sender: 'luna',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
      return;
    }

    addChatMessage({
      id: Date.now().toString(),
      text: chatInput,
      sender: 'user',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });

    setIsLunaTyping(true);
    socketRef.emit('luna_chat', { message: chatInput });
    setChatInput('');
  };

  const getStatusColor = () => {
    if (status.includes('Online') || status.includes('✅') || status.includes('🟢')) return C.green;
    if (status.includes('Error') || status.includes('Disconnected') || status.includes('Logged Out')) return C.red;
    if (status.includes('Connecting') || status.includes('QR')) return C.orange;
    return C.textDim;
  };

  if (isCalling) {
    return (
      <CallScreen
        socket={socketRef}
        callerName={callData.name}
        reason={callData.reason}
        onEndCall={() => setIsCalling(false)}
      />
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Luna</Text>
        <View style={s.statusBadge}>
          <View style={[s.statusDot, { backgroundColor: getStatusColor() }]} />
          <Text style={[s.statusText, { color: getStatusColor() }]}>{status}</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={s.tabs}>
        {['dashboard', 'inbox', 'chat', 'settings', 'logs'].map(tab => (
          <TouchableOpacity
            key={tab}
            style={[s.tab, activeTab === tab && s.activeTab]}
            onPress={() => setActiveTab(tab)}
          >
            <TabIcon name={tab} active={activeTab === tab} />
            <Text style={[s.tabText, activeTab === tab && s.activeTabText]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <KeyboardAvoidingView style={s.content} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

        {/* ====== DASHBOARD ====== */}
        {activeTab === 'dashboard' && (
          <ScrollView style={s.scrollPad} contentContainerStyle={{ paddingBottom: 30 }}>
            {qrCode ? (
              <View style={s.qrCard}>
                <Text style={s.qrTitle}>Scan QR Code</Text>
                <Text style={s.qrSubtitle}>Open WhatsApp → Linked Devices → Scan</Text>
                <View style={s.qrWrapper}>
                  <QRCode value={qrCode} size={220} backgroundColor="#fff" color="#000" />
                </View>
              </View>
            ) : (
              <>
                {/* Status Card */}
                <View style={s.statusCard}>
                  <Text style={s.cardEmoji}>🌙</Text>
                  <Text style={s.cardTitle}>Luna Assistant</Text>
                  <Text style={s.cardSubtitle}>Your AI-powered WhatsApp manager</Text>
                  <View style={[s.statusPill, { backgroundColor: getStatusColor() + '22', borderColor: getStatusColor() }]}>
                    <Text style={[s.statusPillText, { color: getStatusColor() }]}>{status}</Text>
                  </View>
                </View>

                {/* Quick Stats */}
                <View style={s.statsRow}>
                  <View style={s.statCard}>
                    <Text style={s.statNumber}>{activities.filter(a => a.type === 'reply').length}</Text>
                    <Text style={s.statLabel}>Replied</Text>
                  </View>
                  <View style={s.statCard}>
                    <Text style={s.statNumber}>{activities.filter(a => a.type === 'ignore').length}</Text>
                    <Text style={s.statLabel}>Ignored</Text>
                  </View>
                  <View style={s.statCard}>
                    <Text style={[s.statNumber, { color: C.red }]}>{activities.filter(a => a.priority === 'High').length}</Text>
                    <Text style={s.statLabel}>Urgent</Text>
                  </View>
                </View>

                {/* Pause Toggle */}
                <TouchableOpacity
                  style={[s.pauseBtn, isPaused && s.pauseBtnActive]}
                  onPress={() => {
                    const newState = !isPaused;
                    setIsPaused(newState);
                    socketRef?.emit(newState ? 'pause_bot' : 'resume_bot');
                  }}
                >
                  <Text style={s.pauseBtnIcon}>{isPaused ? '▶️' : '⏸️'}</Text>
                  <Text style={s.pauseBtnText}>{isPaused ? 'Resume Luna' : 'Pause Luna'}</Text>
                </TouchableOpacity>
              </>
            )}

            {/* Action Buttons */}
            <View style={s.actionRow}>
              <TouchableOpacity style={s.startBtn} onPress={startBot}>
                <Text style={s.btnIcon}>🚀</Text>
                <Text style={s.btnLabel}>Start Bot</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.logoutBtn} onPress={stopBot}>
                <Text style={s.btnIcon}>🔌</Text>
                <Text style={s.btnLabel}>Logout</Text>
              </TouchableOpacity>
            </View>

            {/* Call Luna Button */}
            <TouchableOpacity style={[s.startBtn, { backgroundColor: C.accent, marginTop: 15 }]} onPress={() => {
              setCallData({ name: 'Me (Test)', reason: 'Manual Test Call' });
              setIsCalling(true);
            }}>
              <Text style={s.btnLabel}>📞 Call Luna</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* ====== INBOX ====== */}
        {activeTab === 'inbox' && (
          <ScrollView style={s.scrollPad} contentContainerStyle={{ paddingBottom: 20 }}>
            <Text style={s.sectionTitle}>Activity Feed</Text>
            {activities.length === 0 ? (
              <View style={s.emptyState}>
                <Text style={s.emptyEmoji}>📭</Text>
                <Text style={s.emptyText}>No activity yet</Text>
                <Text style={s.emptySubtext}>Luna's actions will appear here</Text>
              </View>
            ) : (
              activities.map((act, i) => (
                <View key={i} style={[s.activityCard, {
                  borderLeftColor: act.priority === 'High' ? C.red : act.type === 'voice' ? C.orange : act.type === 'ignore' ? C.textMuted : C.green,
                }]}>
                  <View style={s.activityHeader}>
                    <Text style={s.activityTitle}>{act.title}</Text>
                    <Text style={s.activityTime}>{act.time}</Text>
                  </View>
                  <Text style={s.activityMessage}>{act.message}</Text>
                  {act.replyText ? (
                    <View style={s.replyPreview}>
                      <Text style={s.replyLabel}>Luna replied:</Text>
                      <Text style={s.replyText}>"{act.replyText}"</Text>
                    </View>
                  ) : null}
                </View>
              ))
            )}
          </ScrollView>
        )}

        {/* ====== CHAT WITH LUNA ====== */}
        {activeTab === 'chat' && (
          <View style={s.chatContainer}>
            <ScrollView
              style={s.chatMessages}
              ref={chatScrollRef}
              contentContainerStyle={{ paddingVertical: 15, paddingHorizontal: 15 }}
              onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: true })}
            >
              {chatMessages.length === 0 && (
                <View style={s.chatEmpty}>
                  <Text style={s.chatEmptyEmoji}>💬</Text>
                  <Text style={s.chatEmptyTitle}>Chat with Luna</Text>
                  <Text style={s.chatEmptyText}>Ask her to summarize messages, set reminders, or just talk!</Text>
                </View>
              )}
              {chatMessages.map((msg) => (
                <View
                  key={msg.id}
                  style={[
                    s.chatBubble,
                    msg.sender === 'user' ? s.chatBubbleUser : s.chatBubbleLuna,
                  ]}
                >
                  <Text style={[s.chatBubbleText, msg.sender === 'user' && s.chatBubbleTextUser]}>{msg.text}</Text>
                  <Text style={[s.chatBubbleTime, msg.sender === 'user' && s.chatBubbleTimeUser]}>{msg.time}</Text>
                </View>
              ))}
              {isLunaTyping && (
                <View style={[s.chatBubble, s.chatBubbleLuna]}>
                  <Text style={s.chatBubbleText}>Luna is typing...</Text>
                </View>
              )}
            </ScrollView>
            <View style={s.chatInputRow}>
              <TextInput
                style={s.chatInput}
                value={chatInput}
                onChangeText={setChatInput}
                placeholder="Message Luna..."
                placeholderTextColor={C.textMuted}
                onSubmitEditing={sendChatMessage}
                returnKeyType="send"
              />
              <TouchableOpacity style={s.chatSendBtn} onPress={sendChatMessage}>
                <Text style={s.chatSendText}>➤</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ====== SETTINGS ====== */}
        {activeTab === 'settings' && (
          <ScrollView style={s.scrollPad} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
            <Text style={s.sectionTitle}>Configuration</Text>

            <Text style={s.label}>Backend Server URL</Text>
            <TextInput style={s.input} value={backendUrl} onChangeText={setBackendUrl} placeholder="https://your-app.onrender.com" placeholderTextColor={C.textMuted} autoCapitalize="none" autoCorrect={false} />
            
            <Text style={s.label}>NVIDIA API Key</Text>
            <TextInput style={s.input} value={nvidiaApiKey} onChangeText={setNvidiaApiKey} placeholder="nvapi-..." placeholderTextColor={C.textMuted} secureTextEntry autoCapitalize="none" />

            <Text style={s.label}>Groq API Key (For Voice Calls)</Text>
            <TextInput style={s.input} value={groqApiKey} onChangeText={setGroqApiKey} placeholder="gsk_..." placeholderTextColor={C.textMuted} secureTextEntry autoCapitalize="none" />

            <Text style={s.label}>Relationships</Text>
            <Text style={s.labelHint}>Format: number=label, separated by commas</Text>
            <TextInput style={s.input} value={relationships} onChangeText={setRelationships} placeholder="919876543210=Dad, 918765432109=Girlfriend" placeholderTextColor={C.textMuted} autoCapitalize="none" />
            
            <Text style={s.label}>Excluded Contacts</Text>
            <Text style={s.labelHint}>Numbers to never reply to (comma separated)</Text>
            <TextInput style={s.input} value={excludedNumbers} onChangeText={setExcludedNumbers} placeholder="919876543210, 918765432109" placeholderTextColor={C.textMuted} keyboardType="phone-pad" />
            
            <Text style={s.label}>System Prompt</Text>
            <Text style={s.labelHint}>Luna's personality and behavior rules</Text>
            <TextInput style={s.textArea} value={systemPrompt} onChangeText={setSystemPrompt} multiline textAlignVertical="top" placeholderTextColor={C.textMuted} />
            
            <TouchableOpacity style={s.saveBtn} onPress={saveSettings}>
              <Text style={s.saveBtnText}>💾  Save Settings</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* ====== LOGS ====== */}
        {activeTab === 'logs' && (
          <ScrollView style={s.logsContainer} ref={scrollViewRef} onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}>
            {logs.map((log, i) => (
              <Text key={i} selectable style={s.logText}>{log}</Text>
            ))}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---- Premium Dark Styles ----
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  // Header
  header: { paddingVertical: 18, paddingHorizontal: 20, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.cardBorder, alignItems: 'center' },
  headerTitle: { fontSize: 28, fontWeight: '800', color: C.accent, letterSpacing: 1 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  statusText: { fontSize: 13, fontWeight: '600' },

  // Tabs
  tabs: { flexDirection: 'row', backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.cardBorder },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  activeTab: { borderBottomColor: C.accent },
  tabText: { fontSize: 11, color: C.textMuted, fontWeight: '600', marginTop: 1 },
  activeTabText: { color: C.accent },

  content: { flex: 1 },
  scrollPad: { flex: 1, padding: 16 },

  // Dashboard - QR Card
  qrCard: { backgroundColor: C.card, borderRadius: 16, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: C.cardBorder },
  qrTitle: { fontSize: 20, fontWeight: '700', color: C.text, marginBottom: 6 },
  qrSubtitle: { color: C.textDim, fontSize: 13, marginBottom: 20 },
  qrWrapper: { backgroundColor: '#fff', padding: 16, borderRadius: 12 },

  // Dashboard - Status Card
  statusCard: { backgroundColor: C.card, borderRadius: 16, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: C.cardBorder, marginBottom: 16 },
  cardEmoji: { fontSize: 40, marginBottom: 8 },
  cardTitle: { fontSize: 24, fontWeight: '800', color: C.text, marginBottom: 4 },
  cardSubtitle: { color: C.textDim, fontSize: 14, marginBottom: 16 },
  statusPill: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  statusPillText: { fontSize: 13, fontWeight: '700' },

  // Dashboard - Stats
  statsRow: { flexDirection: 'row', marginBottom: 16, gap: 10 },
  statCard: { flex: 1, backgroundColor: C.card, borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: C.cardBorder },
  statNumber: { fontSize: 28, fontWeight: '800', color: C.accent },
  statLabel: { fontSize: 12, color: C.textDim, marginTop: 4, fontWeight: '600' },

  // Dashboard - Pause Button
  pauseBtn: { backgroundColor: C.card, borderRadius: 12, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.orange + '44', marginBottom: 16 },
  pauseBtnActive: { borderColor: C.green + '44', backgroundColor: C.green + '11' },
  pauseBtnIcon: { fontSize: 18, marginRight: 10 },
  pauseBtnText: { color: C.text, fontSize: 16, fontWeight: '700' },

  // Dashboard - Action Buttons
  actionRow: { flexDirection: 'row', gap: 12 },
  startBtn: { flex: 1, backgroundColor: C.accent, borderRadius: 12, padding: 16, alignItems: 'center' },
  logoutBtn: { flex: 1, backgroundColor: C.red + '22', borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: C.red + '44' },
  btnIcon: { fontSize: 20, marginBottom: 4 },
  btnLabel: { color: C.text, fontSize: 14, fontWeight: '700' },

  // Inbox
  sectionTitle: { fontSize: 20, fontWeight: '800', color: C.text, marginBottom: 16 },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 18, fontWeight: '700', color: C.textDim },
  emptySubtext: { color: C.textMuted, marginTop: 4 },

  activityCard: { backgroundColor: C.card, borderRadius: 12, padding: 14, marginBottom: 10, borderLeftWidth: 4, borderWidth: 1, borderColor: C.cardBorder },
  activityHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  activityTitle: { fontWeight: '700', color: C.text, fontSize: 14, flex: 1 },
  activityTime: { color: C.textMuted, fontSize: 12 },
  activityMessage: { color: C.textDim, fontSize: 13, lineHeight: 18 },
  replyPreview: { marginTop: 8, backgroundColor: C.accent + '11', borderRadius: 8, padding: 10 },
  replyLabel: { color: C.accentLight, fontSize: 11, fontWeight: '700', marginBottom: 4 },
  replyText: { color: C.textDim, fontSize: 13, fontStyle: 'italic' },

  // Chat with Luna
  chatContainer: { flex: 1 },
  chatMessages: { flex: 1, backgroundColor: C.bg },
  chatEmpty: { alignItems: 'center', paddingVertical: 80 },
  chatEmptyEmoji: { fontSize: 48, marginBottom: 12 },
  chatEmptyTitle: { fontSize: 20, fontWeight: '700', color: C.textDim, marginBottom: 6 },
  chatEmptyText: { color: C.textMuted, textAlign: 'center', paddingHorizontal: 40 },

  chatBubble: { maxWidth: '80%', borderRadius: 16, padding: 12, marginBottom: 8 },
  chatBubbleLuna: { alignSelf: 'flex-start', backgroundColor: C.card, borderBottomLeftRadius: 4 },
  chatBubbleUser: { alignSelf: 'flex-end', backgroundColor: C.accent },
  chatBubbleText: { color: C.text, fontSize: 15, lineHeight: 21 },
  chatBubbleTextUser: { color: '#fff' },
  chatBubbleTime: { color: C.textMuted, fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },
  chatBubbleTimeUser: { color: 'rgba(255,255,255,0.6)' },

  chatInputRow: { flexDirection: 'row', padding: 10, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.cardBorder, alignItems: 'center' },
  chatInput: { flex: 1, backgroundColor: C.inputBg, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 10, color: C.text, fontSize: 15, borderWidth: 1, borderColor: C.inputBorder },
  chatSendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  chatSendText: { color: '#fff', fontSize: 20, fontWeight: '700' },

  // Settings
  label: { fontWeight: '700', marginTop: 18, marginBottom: 4, color: C.text, fontSize: 14 },
  labelHint: { color: C.textMuted, fontSize: 12, marginBottom: 6 },
  input: { backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.inputBorder, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.text },
  textArea: { backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.inputBorder, borderRadius: 12, padding: 14, fontSize: 14, height: 180, color: C.text },
  saveBtn: { backgroundColor: C.accent, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },

  // Logs
  logsContainer: { flex: 1, backgroundColor: '#0d0f18', padding: 12 },
  logText: { color: C.green, fontFamily: 'monospace', fontSize: 12, marginBottom: 3, lineHeight: 17 },
});

export default function App() {
  return <ErrorBoundary><LunaApp /></ErrorBoundary>;
}
