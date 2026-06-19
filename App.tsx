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
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
        <SafeAreaView style={{ flex: 1, backgroundColor: '#1a0000', padding: 20 }}>
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

const DEFAULT_PROMPT = "You are Luna, the personal and highly capable WhatsApp assistant to Sufiyan.";

function LunaApp() {
  const [activeTab, setActiveTab] = useState('logs');
  const [status, setStatus] = useState('Testing UI stability...');
  const [logs, setLogs] = useState<string[]>([]);
  const [nvidiaApiKey, setNvidiaApiKey] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_PROMPT);
  const [excludedNumbers, setExcludedNumbers] = useState('');
  const scrollViewRef = useRef<ScrollView>(null);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev.slice(-99), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  useEffect(() => {
    addLog('App started successfully!');
    addLog('nodejs-mobile-react-native is DISABLED for this test.');
    addLog('If you can read this, the UI is stable.');
    addLog('The crash was caused by libnode.so native code.');
    setStatus('UI Stable ✅ (Node.js disabled)');
    
    // Load settings
    AsyncStorage.getItem('nvidiaApiKey').then(v => { if (v) setNvidiaApiKey(v); });
    AsyncStorage.getItem('systemPrompt').then(v => { if (v) setSystemPrompt(v); });
    AsyncStorage.getItem('excludedNumbers').then(v => { if (v) setExcludedNumbers(v); });
  }, []);

  const startBot = () => {
    addLog('Node.js engine is disabled in this test build.');
    addLog('This confirms the crash is from nodejs-mobile-react-native native code.');
  };

  const saveSettings = async () => {
    try {
      await AsyncStorage.setItem('nvidiaApiKey', nvidiaApiKey);
      await AsyncStorage.setItem('systemPrompt', systemPrompt);
      await AsyncStorage.setItem('excludedNumbers', excludedNumbers);
      addLog('Settings saved.');
    } catch (e: any) {
      addLog('Save failed: ' + e.message);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Luna Assistant</Text>
        <Text style={styles.statusText}>Status: {status}</Text>
      </View>

      <View style={styles.tabs}>
        {['dashboard', 'settings', 'logs'].map(tab => (
          <TouchableOpacity key={tab} style={[styles.tab, activeTab === tab && styles.activeTab]} onPress={() => setActiveTab(tab)}>
            <Text style={[styles.tabText, activeTab === tab && { color: '#075E54' }]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <KeyboardAvoidingView style={styles.content} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {activeTab === 'dashboard' && (
          <View style={styles.dashboard}>
            <View style={styles.centerContainer}>
              <Text style={styles.welcomeText}>Welcome to Luna</Text>
              <Text style={styles.infoText}>This is a UI stability test build.</Text>
              <Text style={styles.infoText}>If you can see this, the app is stable! 🎉</Text>
            </View>
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.primaryButton} onPress={startBot}>
                <Text style={styles.buttonText}>START BOT</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {activeTab === 'settings' && (
          <ScrollView style={styles.settings} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>NVIDIA API Key</Text>
            <TextInput style={styles.input} value={nvidiaApiKey} onChangeText={setNvidiaApiKey} placeholder="nvapi-..." placeholderTextColor="#999" secureTextEntry autoCapitalize="none" />
            <Text style={styles.label}>Excluded Contacts</Text>
            <TextInput style={styles.input} value={excludedNumbers} onChangeText={setExcludedNumbers} placeholder="e.g. 919876543210" placeholderTextColor="#999" />
            <Text style={styles.label}>System Prompt</Text>
            <TextInput style={styles.textArea} value={systemPrompt} onChangeText={setSystemPrompt} multiline textAlignVertical="top" placeholderTextColor="#999" />
            <TouchableOpacity style={[styles.primaryButton, { marginBottom: 40 }]} onPress={saveSettings}>
              <Text style={styles.buttonText}>SAVE SETTINGS</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {activeTab === 'logs' && (
          <ScrollView style={styles.logsContainer} ref={scrollViewRef} onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}>
            {logs.map((log, i) => (
              <Text key={i} selectable style={styles.logText}>{log}</Text>
            ))}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { padding: 20, backgroundColor: '#075E54', alignItems: 'center' },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: 'white' },
  statusText: { color: '#dcf8c6', marginTop: 5, fontSize: 13 },
  tabs: { flexDirection: 'row', backgroundColor: 'white', elevation: 2 },
  tab: { flex: 1, padding: 15, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  activeTab: { borderBottomColor: '#075E54' },
  tabText: { fontWeight: 'bold', color: '#999' },
  content: { flex: 1 },
  dashboard: { flex: 1, padding: 20, justifyContent: 'space-between' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  welcomeText: { fontSize: 22, fontWeight: 'bold', color: '#333', marginBottom: 10 },
  infoText: { color: '#666', textAlign: 'center', marginBottom: 10 },
  buttonRow: { flexDirection: 'row', justifyContent: 'center' },
  primaryButton: { backgroundColor: '#128C7E', padding: 15, borderRadius: 8, flex: 1, alignItems: 'center' },
  buttonText: { color: 'white', fontWeight: 'bold' },
  settings: { padding: 20 },
  label: { fontWeight: 'bold', marginTop: 15, marginBottom: 5, color: '#333' },
  input: { backgroundColor: 'white', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, fontSize: 16, color: '#333' },
  textArea: { backgroundColor: 'white', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, fontSize: 14, height: 150, marginBottom: 20, color: '#333' },
  logsContainer: { flex: 1, backgroundColor: '#1e1e1e', padding: 10 },
  logText: { color: '#00ff00', fontFamily: 'monospace', fontSize: 12, marginBottom: 4 },
});

export default function App() {
  return <ErrorBoundary><LunaApp /></ErrorBoundary>;
}
