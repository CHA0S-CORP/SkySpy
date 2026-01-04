import React, { useState, useEffect } from 'react';
import { Plus, Eye, EyeOff, Settings, Trash2 } from 'lucide-react';
import { useSocketApi } from '../../hooks';
import { AlertHistory } from './AlertHistory';
import { RuleForm } from './RuleForm';

export function AlertsView({ apiBase, wsRequest, wsConnected }) {
  const [activeTab, setActiveTab] = useState('rules');
  const { data, refetch } = useSocketApi('/api/v1/alerts/rules', null, apiBase, { wsRequest, wsConnected });
  const [showForm, setShowForm] = useState(false);
  const [editRule, setEditRule] = useState(null);
  const [prefillAircraft, setPrefillAircraft] = useState(null);

  // Listen for create alert from aircraft popup
  useEffect(() => {
    const handleCreateAlert = (e) => {
      const aircraft = e.detail;
      setPrefillAircraft(aircraft);
      setEditRule(null);
      setShowForm(true);
    };
    window.addEventListener('createAlertFromAircraft', handleCreateAlert);
    return () => window.removeEventListener('createAlertFromAircraft', handleCreateAlert);
  }, []);

  const handleDelete = async (id) => {
    if (!confirm('Delete this rule?')) return;
    await fetch(`${apiBase}/api/v1/alerts/rules/${id}`, { method: 'DELETE' });
    refetch();
  };

  const handleToggle = async (rule) => {
    await fetch(`${apiBase}/api/v1/alerts/rules/${rule.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !rule.enabled })
    });
    refetch();
  };

  return (
    <div className="alerts-container">
      <div className="alerts-header">
        <div className="alerts-tabs">
          <button className={`alert-tab ${activeTab === 'rules' ? 'active' : ''}`} onClick={() => setActiveTab('rules')}>
            Rules
          </button>
          <button className={`alert-tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
            History
          </button>
        </div>
        {activeTab === 'rules' && (
          <button className="btn-primary" onClick={() => { setEditRule(null); setShowForm(true); }}>
            <Plus size={16} /> New Rule
          </button>
        )}
      </div>

      {activeTab === 'rules' ? (
        <div className="rules-list">
          {data?.rules?.map(rule => (
            <div key={rule.id} className={`rule-card ${rule.enabled ? '' : 'disabled'}`}>
              <div className="rule-header">
                <span className={`rule-priority ${rule.priority}`}>{rule.priority}</span>
                <span className="rule-name">{rule.name}</span>
                <div className="rule-actions">
                  <button onClick={() => handleToggle(rule)}>
                    {rule.enabled ? <Eye size={16} /> : <EyeOff size={16} />}
                  </button>
                  <button onClick={() => { setEditRule(rule); setShowForm(true); }}>
                    <Settings size={16} />
                  </button>
                  <button onClick={() => handleDelete(rule.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {rule.conditions ? (
                <div className="rule-conditions-summary">
                  {rule.conditions.groups?.map((group, gi) => (
                    <span key={gi}>
                      {gi > 0 && <strong className="logic-operator">{rule.conditions.logic || 'AND'}</strong>}
                      ({group.conditions?.map((c, ci) => (
                        <span key={ci}>
                          {ci > 0 && <span className="condition-logic">{group.logic || 'AND'}</span>}
                          <code>{c.type} {c.operator} {c.value}</code>
                        </span>
                      ))})
                    </span>
                  ))}
                </div>
              ) : (
                <div className="rule-details">
                  <span className="rule-type">{rule.type}</span>
                  <span className="rule-condition">{rule.operator} {rule.value}</span>
                </div>
              )}

              {rule.description && <div className="rule-description">{rule.description}</div>}

              {(rule.starts_at || rule.expires_at) && (
                <div className="rule-schedule">
                  {rule.starts_at && <span>Starts: {new Date(rule.starts_at).toLocaleString()}</span>}
                  {rule.expires_at && <span>Expires: {new Date(rule.expires_at).toLocaleString()}</span>}
                </div>
              )}

              {rule.api_url && (
                <div className="rule-schedule">
                  <span>API URL: <code>{rule.api_url}</code></span>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <AlertHistory apiBase={apiBase} wsRequest={wsRequest} wsConnected={wsConnected} />
      )}

      {showForm && (
        <RuleForm
          rule={editRule}
          prefillAircraft={prefillAircraft}
          apiBase={apiBase}
          onClose={() => { setShowForm(false); setPrefillAircraft(null); }}
          onSave={() => { setShowForm(false); setPrefillAircraft(null); refetch(); }}
        />
      )}
    </div>
  );
}
