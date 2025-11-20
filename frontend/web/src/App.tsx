import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface ResearchData {
  id: string;
  name: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface ResearchStats {
  totalData: number;
  verifiedData: number;
  avgConfidence: number;
  recentUploads: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [researchData, setResearchData] = useState<ResearchData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadingData, setUploadingData] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newResearchData, setNewResearchData] = useState({ 
    name: "", 
    dataValue: "", 
    confidence: "",
    description: "" 
  });
  const [selectedData, setSelectedData] = useState<ResearchData | null>(null);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [operationHistory, setOperationHistory] = useState<string[]>([]);
  const [showFAQ, setShowFAQ] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('FHEVM initialization failed:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM初始化失败" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadResearchData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const addToHistory = (operation: string) => {
    setOperationHistory(prev => [
      `${new Date().toLocaleTimeString()}: ${operation}`,
      ...prev.slice(0, 9)
    ]);
  };

  const loadResearchData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const researchList: ResearchData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const data = await contract.getBusinessData(businessId);
          researchList.push({
            id: businessId,
            name: data.name,
            encryptedValue: businessId,
            publicValue1: Number(data.publicValue1) || 0,
            publicValue2: Number(data.publicValue2) || 0,
            description: data.description,
            timestamp: Number(data.timestamp),
            creator: data.creator,
            isVerified: data.isVerified,
            decryptedValue: Number(data.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading research data:', e);
        }
      }
      
      setResearchData(researchList);
      addToHistory(`加载了 ${researchList.length} 条研究数据`);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "数据加载失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const uploadResearchData = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setUploadingData(true);
    setTransactionStatus({ visible: true, status: "pending", message: "使用Zama FHE加密上传数据..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("合约连接失败");
      
      const dataValue = parseInt(newResearchData.dataValue) || 0;
      const businessId = `research-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, dataValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newResearchData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newResearchData.confidence) || 0,
        0,
        newResearchData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "等待交易确认..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "研究数据上传成功！" });
      addToHistory(`上传研究数据: ${newResearchData.name}`);
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadResearchData();
      setShowUploadModal(false);
      setNewResearchData({ name: "", dataValue: "", confidence: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "用户取消了交易" 
        : "上传失败: " + (e.message || "未知错误");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setUploadingData(false); 
    }
  };

  const decryptResearchData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const researchData = await contractRead.getBusinessData(businessId);
      if (researchData.isVerified) {
        const storedValue = Number(researchData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "数据已在链上验证" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "在链上验证解密..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadResearchData();
      addToHistory(`解密验证数据: ${businessId}`);
      setTransactionStatus({ visible: true, status: "success", message: "数据解密验证成功！" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "数据已在链上验证" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadResearchData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "解密失败: " + (e.message || "未知错误") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "系统可用性检查通过" });
        addToHistory("执行系统可用性检查");
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      console.error('Availability check failed:', e);
    }
  };

  const getResearchStats = (): ResearchStats => {
    const totalData = researchData.length;
    const verifiedData = researchData.filter(d => d.isVerified).length;
    const avgConfidence = researchData.length > 0 
      ? researchData.reduce((sum, d) => sum + d.publicValue1, 0) / researchData.length 
      : 0;
    const recentUploads = researchData.filter(d => 
      Date.now()/1000 - d.timestamp < 60 * 60 * 24 * 7
    ).length;

    return { totalData, verifiedData, avgConfidence, recentUploads };
  };

  const filteredData = researchData.filter(data =>
    data.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    data.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>科研數據隱私庫 🔬</h1>
            <span className="subtitle">FHE全同态加密保护</span>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>连接钱包以继续</h2>
            <p>请连接您的钱包来初始化加密科研数据系统，保护您的未发表研究成果。</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>使用上方按钮连接钱包</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE系统将自动初始化</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>开始上传和验证加密科研数据</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>正在初始化FHE加密系统...</p>
        <p>状态: {fhevmInitializing ? "初始化FHEVM" : status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>加载加密科研数据系统...</p>
    </div>
  );

  const stats = getResearchStats();

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>科研數據隱私庫 🔬</h1>
          <span className="subtitle">FHE全同态加密 · 学术协作验证</span>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="check-btn">
            系统检查
          </button>
          <button onClick={() => setShowUploadModal(true)} className="upload-btn">
            + 上传数据
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panel">
          <div className="stat-card">
            <div className="stat-icon">📊</div>
            <div className="stat-info">
              <div className="stat-value">{stats.totalData}</div>
              <div className="stat-label">总数据量</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">✅</div>
            <div className="stat-info">
              <div className="stat-value">{stats.verifiedData}</div>
              <div className="stat-label">已验证数据</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">🎯</div>
            <div className="stat-info">
              <div className="stat-value">{stats.avgConfidence.toFixed(1)}</div>
              <div className="stat-label">平均置信度</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">🆕</div>
            <div className="stat-info">
              <div className="stat-value">{stats.recentUploads}</div>
              <div className="stat-label">本周新增</div>
            </div>
          </div>
        </div>

        <div className="search-section">
          <div className="search-box">
            <input
              type="text"
              placeholder="搜索研究数据..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <button onClick={loadResearchData} disabled={isRefreshing} className="refresh-btn">
              {isRefreshing ? "刷新中..." : "刷新"}
            </button>
          </div>
        </div>

        <div className="data-section">
          <h2>研究数据列表</h2>
          <div className="data-list">
            {filteredData.length === 0 ? (
              <div className="no-data">
                <p>暂无研究数据</p>
                <button onClick={() => setShowUploadModal(true)} className="upload-btn">
                  上传第一条数据
                </button>
              </div>
            ) : (
              filteredData.map((data, index) => (
                <div 
                  key={index}
                  className={`data-item ${data.isVerified ? 'verified' : ''}`}
                  onClick={() => setSelectedData(data)}
                >
                  <div className="data-header">
                    <h3>{data.name}</h3>
                    <span className={`status-badge ${data.isVerified ? 'verified' : 'pending'}`}>
                      {data.isVerified ? '✅ 已验证' : '🔒 待验证'}
                    </span>
                  </div>
                  <p className="data-description">{data.description}</p>
                  <div className="data-meta">
                    <span>置信度: {data.publicValue1}/10</span>
                    <span>上传时间: {new Date(data.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                  <div className="data-creator">上传者: {data.creator.substring(0, 6)}...{data.creator.substring(38)}</div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="history-section">
          <h3>操作历史</h3>
          <div className="history-list">
            {operationHistory.map((entry, index) => (
              <div key={index} className="history-entry">{entry}</div>
            ))}
            {operationHistory.length === 0 && <p>暂无操作记录</p>}
          </div>
        </div>

        <footer className="app-footer">
          <button onClick={() => setShowFAQ(!showFAQ)} className="faq-btn">
            {showFAQ ? '隐藏' : '显示'}常见问题
          </button>
          {showFAQ && (
            <div className="faq-section">
              <h4>常见问题解答</h4>
              <div className="faq-item">
                <strong>Q: FHE加密如何保护我的研究数据？</strong>
                <p>A: 全同态加密允许在加密数据上直接进行计算验证，原始数据永远不会在未加密状态下暴露。</p>
              </div>
              <div className="faq-item">
                <strong>Q: 数据验证过程是怎样的？</strong>
                <p>A: 通过零知识证明技术，验证者可以确认计算结果的正确性，而无需访问原始数据。</p>
              </div>
              <div className="faq-item">
                <strong>Q: 支持哪些类型的数据？</strong>
                <p>A: 目前支持整数类型数据的加密和同态计算验证。</p>
              </div>
            </div>
          )}
        </footer>
      </div>
      
      {showUploadModal && (
        <UploadModal 
          onSubmit={uploadResearchData}
          onClose={() => setShowUploadModal(false)}
          uploading={uploadingData}
          researchData={newResearchData}
          setResearchData={setNewResearchData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedData && (
        <DetailModal 
          data={selectedData}
          onClose={() => setSelectedData(null)}
          onDecrypt={decryptResearchData}
          isDecrypting={fheIsDecrypting}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const UploadModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  uploading: boolean;
  researchData: any;
  setResearchData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, uploading, researchData, setResearchData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'dataValue') {
      const intValue = value.replace(/[^\d]/g, '');
      setResearchData({ ...researchData, [name]: intValue });
    } else {
      setResearchData({ ...researchData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="upload-modal">
        <div className="modal-header">
          <h2>上传研究数据</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE全同态加密保护</strong>
            <p>研究数据将使用Zama FHE进行加密（仅支持整数）</p>
          </div>
          
          <div className="form-group">
            <label>研究名称 *</label>
            <input 
              type="text" 
              name="name" 
              value={researchData.name} 
              onChange={handleChange} 
              placeholder="输入研究项目名称..." 
            />
          </div>
          
          <div className="form-group">
            <label>研究数据值（整数） *</label>
            <input 
              type="number" 
              name="dataValue" 
              value={researchData.dataValue} 
              onChange={handleChange} 
              placeholder="输入研究数据值..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE加密整数</div>
          </div>
          
          <div className="form-group">
            <label>数据置信度 (1-10) *</label>
            <input 
              type="number" 
              min="1" 
              max="10" 
              name="confidence" 
              value={researchData.confidence} 
              onChange={handleChange} 
              placeholder="输入置信度评分..." 
            />
            <div className="data-type-label">公开数据</div>
          </div>
          
          <div className="form-group">
            <label>研究描述</label>
            <textarea 
              name="description" 
              value={researchData.description} 
              onChange={handleChange} 
              placeholder="描述研究内容和方法..."
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">取消</button>
          <button 
            onClick={onSubmit} 
            disabled={uploading || isEncrypting || !researchData.name || !researchData.dataValue || !researchData.confidence} 
            className="submit-btn"
          >
            {uploading || isEncrypting ? "加密并上传中..." : "上传数据"}
          </button>
        </div>
      </div>
    </div>
  );
};

const DetailModal: React.FC<{
  data: ResearchData;
  onClose: () => void;
  onDecrypt: (businessId: string) => Promise<number | null>;
  isDecrypting: boolean;
}> = ({ data, onClose, onDecrypt, isDecrypting }) => {
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);

  const handleDecrypt = async () => {
    const value = await onDecrypt(data.id);
    if (value !== null) {
      setDecryptedValue(value);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>研究数据详情</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="data-info">
            <div className="info-item">
              <span>研究名称:</span>
              <strong>{data.name}</strong>
            </div>
            <div className="info-item">
              <span>上传者:</span>
              <strong>{data.creator.substring(0, 6)}...{data.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>上传时间:</span>
              <strong>{new Date(data.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-item">
              <span>置信度:</span>
              <strong>{data.publicValue1}/10</strong>
            </div>
            <div className="info-item">
              <span>研究描述:</span>
              <p>{data.description}</p>
            </div>
          </div>
          
          <div className="encryption-section">
            <h3>加密数据验证</h3>
            <div className="data-row">
              <div className="data-label">研究数据值:</div>
              <div className="data-value">
                {data.isVerified && data.decryptedValue ? 
                  `${data.decryptedValue} (链上已验证)` : 
                  decryptedValue !== null ? 
                  `${decryptedValue} (本地解密)` : 
                  "🔒 FHE加密整数"
                }
              </div>
              <button 
                className={`decrypt-btn ${(data.isVerified || decryptedValue !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "🔓 验证中..." :
                 data.isVerified ? "✅ 已验证" :
                 decryptedValue !== null ? "🔄 重新验证" :
                 "🔓 验证解密"}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE全同态验证流程</strong>
                <p>数据在链上加密存储，点击验证进行离线解密和链上零知识证明验证。</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">关闭</button>
        </div>
      </div>
    </div>
  );
};

export default App;

