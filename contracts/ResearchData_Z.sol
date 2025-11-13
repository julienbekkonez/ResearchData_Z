pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ResearchDataVault is ZamaEthereumConfig {
    
    struct EncryptedDataset {
        string experimentId;                    
        euint32 encryptedValue;        
        uint256 publicParameter1;          
        uint256 publicParameter2;          
        string metadata;            
        address researcher;               
        uint256 submissionTime;             
        uint32 decryptedValue; 
        bool verificationStatus; 
    }
    

    mapping(string => EncryptedDataset) public researchDatasets;
    
    string[] public experimentIds;
    
    event DatasetSubmitted(string indexed experimentId, address indexed researcher);
    event VerificationCompleted(string indexed experimentId, uint32 decryptedValue);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function submitEncryptedData(
        string calldata experimentId,
        string calldata experimentName,
        externalEuint32 encryptedValue,
        bytes calldata inputProof,
        uint256 publicParameter1,
        uint256 publicParameter2,
        string calldata metadata
    ) external {
        require(bytes(researchDatasets[experimentId].experimentId).length == 0, "Dataset already exists");
        
        require(FHE.isInitialized(FHE.fromExternal(encryptedValue, inputProof)), "Invalid encrypted input");
        
        researchDatasets[experimentId] = EncryptedDataset({
            experimentId: experimentName,
            encryptedValue: FHE.fromExternal(encryptedValue, inputProof),
            publicParameter1: publicParameter1,
            publicParameter2: publicParameter2,
            metadata: metadata,
            researcher: msg.sender,
            submissionTime: block.timestamp,
            decryptedValue: 0,
            verificationStatus: false
        });
        
        FHE.allowThis(researchDatasets[experimentId].encryptedValue);
        
        FHE.makePubliclyDecryptable(researchDatasets[experimentId].encryptedValue);
        
        experimentIds.push(experimentId);
        
        emit DatasetSubmitted(experimentId, msg.sender);
    }
    
    function verifyComputation(
        string calldata experimentId, 
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(researchDatasets[experimentId].experimentId).length > 0, "Dataset does not exist");
        require(!researchDatasets[experimentId].verificationStatus, "Data already verified");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(researchDatasets[experimentId].encryptedValue);
        
        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        
        researchDatasets[experimentId].decryptedValue = decodedValue;
        researchDatasets[experimentId].verificationStatus = true;
        
        emit VerificationCompleted(experimentId, decodedValue);
    }
    
    function getEncryptedDataset(string calldata experimentId) external view returns (euint32) {
        require(bytes(researchDatasets[experimentId].experimentId).length > 0, "Dataset does not exist");
        return researchDatasets[experimentId].encryptedValue;
    }
    
    function getResearchMetadata(string calldata experimentId) external view returns (
        string memory experimentName,
        uint256 publicParameter1,
        uint256 publicParameter2,
        string memory metadata,
        address researcher,
        uint256 submissionTime,
        bool verificationStatus,
        uint32 decryptedValue
    ) {
        require(bytes(researchDatasets[experimentId].experimentId).length > 0, "Dataset does not exist");
        EncryptedDataset storage data = researchDatasets[experimentId];
        
        return (
            data.experimentId,
            data.publicParameter1,
            data.publicParameter2,
            data.metadata,
            data.researcher,
            data.submissionTime,
            data.verificationStatus,
            data.decryptedValue
        );
    }
    
    function getAllExperimentIds() external view returns (string[] memory) {
        return experimentIds;
    }
    
    function contractActive() public pure returns (bool) {
        return true;
    }
}

