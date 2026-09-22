// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RoleManager} from "./RoleManager.sol";
import {PatientRegistry} from "./PatientRegistry.sol";
import {RecordAccessControl} from "./AccessControl.sol";
import {EmergencyAccess} from "./EmergencyAccess.sol";
import {AuditLog} from "./AuditLog.sol";

/// @title MedicalRecordRegistry
/// @notice Stores cryptographic hashes/references of off-chain medical records only.
contract MedicalRecordRegistry {
    enum RecordType {
        BIRTH,
        VACCINATION,
        DIAGNOSIS,
        ALLERGY,
        LAB_TEST,
        PRESCRIPTION,
        MEDICATION,
        HOSPITAL_ADMISSION,
        HOSPITAL_DISCHARGE,
        SURGERY,
        FOLLOW_UP,
        EMERGENCY_TREATMENT,
        MEDICAL_DOCUMENT
    }

    enum RecordOrigin {
        CURRENT,
        HISTORICAL
    }

    struct MedicalRecord {
        string recordId;
        string patientId;
        RecordType recordType;
        bytes32 recordHash;
        address createdBy;
        uint256 timestamp;
        RecordOrigin recordOrigin;
        uint256 recordDate;
        uint256 registeredAt;
        bool active;
        bool exists;
    }

    RoleManager public immutable roleManager;
    PatientRegistry public immutable patientRegistry;
    RecordAccessControl public immutable recordAccess;
    EmergencyAccess public immutable emergencyAccess;
    AuditLog public immutable auditLog;

    mapping(bytes32 => MedicalRecord) private records;

    event MedicalRecordCreated(
        string recordId, string patientId, RecordType recordType, bytes32 recordHash, address indexed createdBy
    );
    event MedicalRecordUpdated(string recordId, bytes32 previousHash, bytes32 newHash, address indexed updatedBy);
    event MedicalRecordDeactivated(string recordId, address indexed deactivatedBy);

    error Unauthorized();
    error ZeroAddress();
    error InvalidIdentifier();
    error InvalidHash();
    error InvalidRecordDate();
    error PatientInactive();
    error RecordAlreadyExists();
    error RecordNotFound();
    error RecordInactive();

    constructor(
        address roleManager_,
        address patientRegistry_,
        address recordAccess_,
        address emergencyAccess_,
        address auditLog_
    ) {
        if (
            roleManager_ == address(0) || patientRegistry_ == address(0) || recordAccess_ == address(0)
                || emergencyAccess_ == address(0) || auditLog_ == address(0)
        ) {
            revert ZeroAddress();
        }
        roleManager = RoleManager(roleManager_);
        patientRegistry = PatientRegistry(patientRegistry_);
        recordAccess = RecordAccessControl(recordAccess_);
        emergencyAccess = EmergencyAccess(emergencyAccess_);
        auditLog = AuditLog(auditLog_);
    }

    function registerRecordHash(
        string calldata recordId,
        string calldata patientId,
        RecordType recordType,
        bytes32 recordHash
    ) external {
        if (bytes(recordId).length == 0) revert InvalidIdentifier();
        if (recordHash == bytes32(0)) revert InvalidHash();
        if (!patientRegistry.isActivePatient(patientId)) revert PatientInactive();
        _requireWritePermission(patientId);

        bytes32 key = _key(recordId);
        if (records[key].exists) revert RecordAlreadyExists();

        records[key] = MedicalRecord({
            recordId: recordId,
            patientId: patientId,
            recordType: recordType,
            recordHash: recordHash,
            createdBy: msg.sender,
            timestamp: block.timestamp,
            recordOrigin: RecordOrigin.CURRENT,
            recordDate: block.timestamp,
            registeredAt: block.timestamp,
            active: true,
            exists: true
        });

        emit MedicalRecordCreated(recordId, patientId, recordType, recordHash, msg.sender);
        auditLog.recordAudit(msg.sender, patientId, "RECORD_CREATED", recordId, true);
    }

    function registerHistoricalRecordHash(
        string calldata recordId,
        string calldata patientId,
        RecordType recordType,
        bytes32 recordHash,
        uint256 recordDate
    ) external {
        if (bytes(recordId).length == 0) revert InvalidIdentifier();
        if (recordHash == bytes32(0)) revert InvalidHash();
        if (recordDate == 0) revert InvalidRecordDate();
        if (!patientRegistry.isActivePatient(patientId)) revert PatientInactive();
        _requireWritePermission(patientId);

        bytes32 key = _key(recordId);
        if (records[key].exists) revert RecordAlreadyExists();

        records[key] = MedicalRecord({
            recordId: recordId,
            patientId: patientId,
            recordType: recordType,
            recordHash: recordHash,
            createdBy: msg.sender,
            timestamp: block.timestamp,
            recordOrigin: RecordOrigin.HISTORICAL,
            recordDate: recordDate,
            registeredAt: block.timestamp,
            active: true,
            exists: true
        });

        emit MedicalRecordCreated(recordId, patientId, recordType, recordHash, msg.sender);
        auditLog.recordAudit(msg.sender, patientId, "RECORD_CREATED", recordId, true);
    }

    function updateRecordHash(string calldata recordId, bytes32 newHash) external {
        if (newHash == bytes32(0)) revert InvalidHash();
        MedicalRecord storage record_ = _requireRecord(recordId);
        if (!record_.active) revert RecordInactive();
        _requireUpdatePermission(record_);

        bytes32 previousHash = record_.recordHash;
        record_.recordHash = newHash;
        record_.timestamp = block.timestamp;

        emit MedicalRecordUpdated(recordId, previousHash, newHash, msg.sender);
        auditLog.recordAudit(msg.sender, record_.patientId, "RECORD_UPDATED", recordId, true);
    }

    function getRecordHash(string calldata recordId) external view returns (bytes32) {
        MedicalRecord storage record_ = _requireRecord(recordId);
        return record_.recordHash;
    }

    function getRecordMetadata(string calldata recordId)
        external
        view
        returns (RecordOrigin recordOrigin, uint256 recordDate, uint256 registeredAt)
    {
        MedicalRecord storage record_ = _requireRecord(recordId);
        return (record_.recordOrigin, record_.recordDate, record_.registeredAt);
    }

    function getRecord(string calldata recordId)
        external
        view
        returns (
            string memory id,
            string memory patientId,
            RecordType recordType,
            bytes32 recordHash,
            address createdBy,
            uint256 timestamp,
            bool active
        )
    {
        MedicalRecord storage record_ = _requireRecord(recordId);
        return (
            record_.recordId,
            record_.patientId,
            record_.recordType,
            record_.recordHash,
            record_.createdBy,
            record_.timestamp,
            record_.active
        );
    }

    function verifyRecordHash(string calldata recordId, bytes32 submittedHash) external returns (bool verified) {
        MedicalRecord storage record_ = _requireRecord(recordId);
        verified = record_.active && record_.recordHash == submittedHash;
        auditLog.recordAudit(msg.sender, record_.patientId, "RECORD_VERIFIED", recordId, verified);
    }

    function deactivateRecord(string calldata recordId) external {
        MedicalRecord storage record_ = _requireRecord(recordId);
        if (!record_.active) revert RecordInactive();
        if (msg.sender != record_.createdBy && !roleManager.isHospitalAdmin(msg.sender)) {
            revert Unauthorized();
        }

        record_.active = false;
        emit MedicalRecordDeactivated(recordId, msg.sender);
        auditLog.recordAudit(msg.sender, record_.patientId, "RECORD_DEACTIVATED", recordId, true);
    }

    function _requireWritePermission(string calldata patientId) internal view {
        if (roleManager.isHospitalAdmin(msg.sender)) return;
        if (!roleManager.isMedicalStaff(msg.sender)) revert Unauthorized();
        if (recordAccess.hasAccess(patientId, msg.sender)) return;
        if (emergencyAccess.checkEmergencyAccess(patientId, msg.sender)) return;
        revert Unauthorized();
    }

    function _requireUpdatePermission(MedicalRecord storage record_) internal view {
        if (msg.sender == record_.createdBy || roleManager.isHospitalAdmin(msg.sender)) return;
        revert Unauthorized();
    }

    function _requireRecord(string calldata recordId) internal view returns (MedicalRecord storage record_) {
        record_ = records[_key(recordId)];
        if (!record_.exists) revert RecordNotFound();
    }

    function _key(string calldata recordId) internal pure returns (bytes32) {
        return keccak256(bytes(recordId));
    }
}
