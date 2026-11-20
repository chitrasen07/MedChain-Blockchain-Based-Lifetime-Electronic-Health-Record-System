// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RoleManager} from "./RoleManager.sol";
import {PatientRegistry} from "./PatientRegistry.sol";
import {AuditLog} from "./AuditLog.sol";

/// @title EmergencyAccess
/// @notice One bounded break-glass grant per responder. It cannot be extended in place.
contract EmergencyAccess {
    uint256 public constant MAX_DURATION = 72 hours;

    struct EmergencyGrant {
        address doctor;
        bytes32 patientRef;
        bytes32 reasonHash;
        uint64 startedAt;
        uint64 expiresAt;
        uint64 cooldownEndsAt;
        bool active;
        bool exists;
    }

    RoleManager public immutable roleManager;
    PatientRegistry public immutable patientRegistry;
    AuditLog public immutable auditLog;
    mapping(bytes32 => EmergencyGrant) private grants;

    bytes32 private constant EMERGENCY_GRANTED = keccak256("EMERGENCY_ACCESS_GRANTED");
    bytes32 private constant EMERGENCY_REVOKED = keccak256("EMERGENCY_ACCESS_REVOKED");
    bytes32 private constant EMERGENCY_EXPIRED = keccak256("EMERGENCY_ACCESS_EXPIRED");

    event EmergencyAccessGranted(
        bytes32 indexed patientRef, address indexed doctor, bytes32 reasonHash, uint256 expiresAt
    );
    event EmergencyAccessRevoked(bytes32 indexed patientRef, address indexed doctor, address indexed revokedBy);
    event EmergencyAccessExpired(bytes32 indexed patientRef, address indexed doctor, uint256 expiresAt);

    error Unauthorized();
    error ZeroAddress();
    error InvalidDuration();
    error InvalidReason();
    error PatientInactive();
    error NoActiveGrant();
    error NotExpired();
    error EmergencyCooldown();

    constructor(address roleManager_, address patientRegistry_, address auditLog_) {
        if (roleManager_ == address(0) || patientRegistry_ == address(0) || auditLog_ == address(0)) {
            revert ZeroAddress();
        }
        roleManager = RoleManager(roleManager_);
        patientRegistry = PatientRegistry(patientRegistry_);
        auditLog = AuditLog(auditLog_);
    }

    function requestEmergencyAccess(bytes32 patientRef, bytes32 reasonHash, uint256 duration) external {
        if (!roleManager.isEmergencyResponder(msg.sender)) revert Unauthorized();
        if (duration == 0 || duration > MAX_DURATION) revert InvalidDuration();
        if (reasonHash == bytes32(0)) revert InvalidReason();
        if (!patientRegistry.isActivePatient(patientRef)) revert PatientInactive();

        bytes32 key = _key(patientRef, msg.sender);
        EmergencyGrant storage grant = grants[key];
        if (grant.exists && block.timestamp < grant.cooldownEndsAt) revert EmergencyCooldown();

        uint64 expiresAt = uint64(block.timestamp + duration);
        grants[key] = EmergencyGrant({
            doctor: msg.sender,
            patientRef: patientRef,
            reasonHash: reasonHash,
            startedAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            cooldownEndsAt: expiresAt + uint64(MAX_DURATION),
            active: true,
            exists: true
        });
        emit EmergencyAccessGranted(patientRef, msg.sender, reasonHash, expiresAt);
        auditLog.recordAudit(msg.sender, patientRef, EMERGENCY_GRANTED, true);
    }

    function checkEmergencyAccess(bytes32 patientRef, address doctor) public view returns (bool) {
        if (!patientRegistry.isActivePatient(patientRef)) return false;
        EmergencyGrant storage grant = grants[_key(patientRef, doctor)];
        if (!grant.exists || !grant.active) return false;
        if (block.timestamp >= grant.expiresAt) return false;
        return true;
    }

    function revokeEmergencyAccess(bytes32 patientRef, address doctor) external {
        EmergencyGrant storage grant = grants[_key(patientRef, doctor)];
        if (!grant.exists || !grant.active) revert NoActiveGrant();
        address controller = patientRegistry.getController(patientRef);
        bool allowed = msg.sender == doctor || msg.sender == controller || roleManager.isHospitalAdmin(msg.sender);
        if (!allowed) revert Unauthorized();
        grant.active = false;
        emit EmergencyAccessRevoked(patientRef, doctor, msg.sender);
        auditLog.recordAudit(msg.sender, patientRef, EMERGENCY_REVOKED, true);
    }

    function expireEmergencyAccess(bytes32 patientRef, address doctor) external {
        EmergencyGrant storage grant = grants[_key(patientRef, doctor)];
        if (!grant.exists || !grant.active) revert NoActiveGrant();
        if (block.timestamp < grant.expiresAt) revert NotExpired();
        grant.active = false;
        emit EmergencyAccessExpired(patientRef, doctor, grant.expiresAt);
        auditLog.recordAudit(msg.sender, patientRef, EMERGENCY_EXPIRED, true);
    }

    function _key(bytes32 patientRef, address doctor) internal pure returns (bytes32) {
        return keccak256(abi.encode(patientRef, doctor));
    }
}
