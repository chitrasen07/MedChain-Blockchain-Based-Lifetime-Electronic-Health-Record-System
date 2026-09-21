// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RoleManager} from "./RoleManager.sol";
import {PatientRegistry} from "./PatientRegistry.sol";
import {AuditLog} from "./AuditLog.sol";

/// @title EmergencyAccess
/// @notice Temporary, expiring emergency access for authorized medical responders.
contract EmergencyAccess {
    uint256 public constant MAX_DURATION = 72 hours;

    struct EmergencyGrant {
        address doctor;
        string patientId;
        bytes32 reasonHash;
        uint256 startedAt;
        uint256 expiresAt;
        bool active;
        bool exists;
    }

    RoleManager public immutable roleManager;
    PatientRegistry public immutable patientRegistry;
    AuditLog public immutable auditLog;

    mapping(bytes32 => EmergencyGrant) private grants;

    event EmergencyAccessRequested(
        string patientId, address indexed doctor, bytes32 reasonHash, uint256 expiresAt
    );
    event EmergencyAccessGranted(
        string patientId, address indexed doctor, bytes32 reasonHash, uint256 startedAt, uint256 expiresAt
    );
    event EmergencyAccessRevoked(string patientId, address indexed doctor, address indexed revokedBy);
    event EmergencyAccessExpired(string patientId, address indexed doctor, uint256 expiresAt);

    error Unauthorized();
    error ZeroAddress();
    error InvalidDuration();
    error InvalidReason();
    error PatientInactive();
    error NoActiveGrant();
    error NotExpired();

    constructor(address roleManager_, address patientRegistry_, address auditLog_) {
        if (roleManager_ == address(0) || patientRegistry_ == address(0) || auditLog_ == address(0)) {
            revert ZeroAddress();
        }
        roleManager = RoleManager(roleManager_);
        patientRegistry = PatientRegistry(patientRegistry_);
        auditLog = AuditLog(auditLog_);
    }

    function requestEmergencyAccess(string calldata patientId, bytes32 reasonHash, uint256 duration)
        external
    {
        if (!roleManager.isEmergencyResponder(msg.sender)) revert Unauthorized();
        if (duration == 0 || duration > MAX_DURATION) revert InvalidDuration();
        if (reasonHash == bytes32(0)) revert InvalidReason();
        if (!patientRegistry.isActivePatient(patientId)) revert PatientInactive();

        uint256 expiresAt = block.timestamp + duration;
        bytes32 key = _key(patientId, msg.sender);

        grants[key] = EmergencyGrant({
            doctor: msg.sender,
            patientId: patientId,
            reasonHash: reasonHash,
            startedAt: block.timestamp,
            expiresAt: expiresAt,
            active: true,
            exists: true
        });

        emit EmergencyAccessRequested(patientId, msg.sender, reasonHash, expiresAt);
        emit EmergencyAccessGranted(patientId, msg.sender, reasonHash, block.timestamp, expiresAt);
        auditLog.recordAudit(msg.sender, patientId, "EMERGENCY_ACCESS_REQUESTED", _toHex(reasonHash), true);
        auditLog.recordAudit(msg.sender, patientId, "EMERGENCY_ACCESS_GRANTED", _toHex(reasonHash), true);
    }

    function checkEmergencyAccess(string calldata patientId, address doctor) public view returns (bool) {
        if (!patientRegistry.isActivePatient(patientId)) return false;
        EmergencyGrant storage grant = grants[_key(patientId, doctor)];
        if (!grant.exists || !grant.active) return false;
        if (block.timestamp >= grant.expiresAt) return false;
        return true;
    }

    function revokeEmergencyAccess(string calldata patientId, address doctor) external {
        EmergencyGrant storage grant = grants[_key(patientId, doctor)];
        if (!grant.exists || !grant.active) revert NoActiveGrant();

        address controller = patientRegistry.getController(patientId);
        bool allowed = msg.sender == doctor || msg.sender == controller || roleManager.isHospitalAdmin(msg.sender);
        if (!allowed) revert Unauthorized();

        grant.active = false;
        emit EmergencyAccessRevoked(patientId, doctor, msg.sender);
        auditLog.recordAudit(msg.sender, patientId, "EMERGENCY_ACCESS_REVOKED", _toHex(bytes32(uint256(uint160(doctor)))), true);
    }

    function expireEmergencyAccess(string calldata patientId, address doctor) external {
        EmergencyGrant storage grant = grants[_key(patientId, doctor)];
        if (!grant.exists || !grant.active) revert NoActiveGrant();
        if (block.timestamp < grant.expiresAt) revert NotExpired();

        grant.active = false;
        emit EmergencyAccessExpired(patientId, doctor, grant.expiresAt);
    }

    function getEmergencyAccess(string calldata patientId, address doctor)
        external
        view
        returns (
            address doctorAddress,
            bytes32 reasonHash,
            uint256 startedAt,
            uint256 expiresAt,
            bool active
        )
    {
        EmergencyGrant storage grant = grants[_key(patientId, doctor)];
        if (!grant.exists) revert NoActiveGrant();
        bool currentlyActive =
            grant.active && block.timestamp < grant.expiresAt && patientRegistry.isActivePatient(patientId);
        return (grant.doctor, grant.reasonHash, grant.startedAt, grant.expiresAt, currentlyActive);
    }

    function _key(string calldata patientId, address doctor) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(patientId, doctor));
    }

    function _toHex(bytes32 data) internal pure returns (string memory) {
        bytes16 hexSymbols = "0123456789abcdef";
        bytes memory str = new bytes(66);
        str[0] = "0";
        str[1] = "x";
        for (uint256 i = 0; i < 32; i++) {
            uint8 b = uint8(data[i]);
            str[2 + i * 2] = hexSymbols[b >> 4];
            str[3 + i * 2] = hexSymbols[b & 0x0f];
        }
        return string(str);
    }
}
