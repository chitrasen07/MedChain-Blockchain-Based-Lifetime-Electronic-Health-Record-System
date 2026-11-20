// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RoleManager} from "./RoleManager.sol";
import {PatientRegistry} from "./PatientRegistry.sol";
import {RecordAccessControl} from "./AccessControl.sol";
import {EmergencyAccess} from "./EmergencyAccess.sol";
import {AuditLog} from "./AuditLog.sol";

/// @title MedicalRecordRegistry
/// @notice Append-only hashes of off-chain records. No document, diagnosis, or personal data is stored.
/// @dev Hashes and references are public. Authorization is enforced at call time and is not retained
/// by the original author after consent or emergency access ends.
contract MedicalRecordRegistry {
    struct RecordVersion {
        bytes32 recordHash;
        address author;
        uint256 recordDate;
        uint256 registeredAt;
    }

    struct Record {
        bytes32 patientRef;
        RecordVersion[] versions;
        bool active;
        bool exists;
    }

    RoleManager public immutable roleManager;
    PatientRegistry public immutable patientRegistry;
    RecordAccessControl public immutable recordAccess;
    EmergencyAccess public immutable emergencyAccess;
    AuditLog public immutable auditLog;
    mapping(bytes32 => Record) private records;

    bytes32 private constant RECORD_CREATED = keccak256("RECORD_CREATED");
    bytes32 private constant RECORD_VERSION_APPENDED = keccak256("RECORD_VERSION_APPENDED");
    bytes32 private constant RECORD_VERIFIED = keccak256("RECORD_VERIFIED");
    bytes32 private constant RECORD_DEACTIVATED = keccak256("RECORD_DEACTIVATED");

    event RecordVersionAppended(
        bytes32 indexed recordRef, bytes32 indexed patientRef, bytes32 recordHash, uint256 versionIndex, address indexed author
    );
    event RecordDeactivated(bytes32 indexed recordRef, address indexed deactivatedBy);

    error Unauthorized();
    error ZeroAddress();
    error InvalidIdentifier();
    error InvalidHash();
    error InvalidRecordDate();
    error PatientInactive();
    error RecordAlreadyExists();
    error RecordNotFound();
    error RecordInactive();
    error VersionNotFound();

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
        ) revert ZeroAddress();
        roleManager = RoleManager(roleManager_);
        patientRegistry = PatientRegistry(patientRegistry_);
        recordAccess = RecordAccessControl(recordAccess_);
        emergencyAccess = EmergencyAccess(emergencyAccess_);
        auditLog = AuditLog(auditLog_);
    }

    function createRecord(bytes32 recordRef, bytes32 patientRef, bytes32 recordHash, uint256 recordDate) external {
        if (recordRef == bytes32(0)) revert InvalidIdentifier();
        if (records[recordRef].exists) revert RecordAlreadyExists();
        if (!patientRegistry.isActivePatient(patientRef)) revert PatientInactive();
        _requireWrite(patientRef);
        uint256 dated = _dated(recordDate);
        records[recordRef].patientRef = patientRef;
        records[recordRef].active = true;
        records[recordRef].exists = true;
        _append(recordRef, patientRef, recordHash, dated, RECORD_CREATED);
    }

    function appendRecordVersion(bytes32 recordRef, bytes32 recordHash, uint256 recordDate) external {
        Record storage record_ = _requireRecord(recordRef);
        if (!record_.active) revert RecordInactive();
        if (!patientRegistry.isActivePatient(record_.patientRef)) revert PatientInactive();
        _requireWrite(record_.patientRef);
        _append(recordRef, record_.patientRef, recordHash, _dated(recordDate), RECORD_VERSION_APPENDED);
    }

    function verifyRecordHash(bytes32 recordRef, uint256 versionIndex, bytes32 submittedHash)
        external
        returns (bool verified)
    {
        Record storage record_ = _requireRecord(recordRef);
        _requireReader(record_.patientRef);
        if (versionIndex >= record_.versions.length) revert VersionNotFound();
        verified = record_.versions[versionIndex].recordHash == submittedHash;
        auditLog.recordAudit(msg.sender, recordRef, RECORD_VERIFIED, verified);
    }

    function deactivateRecord(bytes32 recordRef) external {
        Record storage record_ = _requireRecord(recordRef);
        if (!record_.active) revert RecordInactive();
        if (!patientRegistry.isActivePatient(record_.patientRef)) revert PatientInactive();
        address controller = patientRegistry.getController(record_.patientRef);
        if (msg.sender != controller) _requireWrite(record_.patientRef);
        record_.active = false;
        emit RecordDeactivated(recordRef, msg.sender);
        auditLog.recordAudit(msg.sender, recordRef, RECORD_DEACTIVATED, true);
    }

    function versionCount(bytes32 recordRef) external view returns (uint256) {
        return _requireRecord(recordRef).versions.length;
    }

    function getVersion(bytes32 recordRef, uint256 versionIndex)
        external
        view
        returns (bytes32 recordHash, address author, uint256 recordDate, uint256 registeredAt)
    {
        Record storage record_ = _requireRecord(recordRef);
        if (versionIndex >= record_.versions.length) revert VersionNotFound();
        RecordVersion storage version = record_.versions[versionIndex];
        return (version.recordHash, version.author, version.recordDate, version.registeredAt);
    }

    function getRecord(bytes32 recordRef) external view returns (bytes32 patientRef, uint256 versions, bool active) {
        Record storage record_ = _requireRecord(recordRef);
        return (record_.patientRef, record_.versions.length, record_.active);
    }

    function _append(bytes32 recordRef, bytes32 patientRef, bytes32 recordHash, uint256 recordDate, bytes32 actionCode)
        internal
    {
        if (recordHash == bytes32(0)) revert InvalidHash();
        Record storage record_ = records[recordRef];
        record_.versions.push(
            RecordVersion({
                recordHash: recordHash,
                author: msg.sender,
                recordDate: recordDate,
                registeredAt: block.timestamp
            })
        );
        emit RecordVersionAppended(recordRef, patientRef, recordHash, record_.versions.length - 1, msg.sender);
        auditLog.recordAudit(msg.sender, recordRef, actionCode, true);
    }

    function _dated(uint256 recordDate) internal view returns (uint256) {
        if (recordDate == 0) return block.timestamp;
        if (recordDate > block.timestamp) revert InvalidRecordDate();
        return recordDate;
    }

    function _requireWrite(bytes32 patientRef) internal view {
        if (!roleManager.isMedicalStaff(msg.sender)) revert Unauthorized();
        if (recordAccess.hasAccess(patientRef, msg.sender)) return;
        if (emergencyAccess.checkEmergencyAccess(patientRef, msg.sender)) return;
        revert Unauthorized();
    }

    function _requireReader(bytes32 patientRef) internal view {
        address controller = patientRegistry.getController(patientRef);
        if (msg.sender == controller) return;
        _requireWrite(patientRef);
    }

    function _requireRecord(bytes32 recordRef) internal view returns (Record storage record_) {
        record_ = records[recordRef];
        if (!record_.exists) revert RecordNotFound();
    }
}
