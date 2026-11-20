// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RoleManager} from "./RoleManager.sol";
import {PatientRegistry} from "./PatientRegistry.sol";
import {AuditLog} from "./AuditLog.sol";

/// @title RecordAccessControl
/// @notice Consent grants controlled only by the patient controller.
contract RecordAccessControl {
    struct AccessGrant {
        bytes32 patientRef;
        address authorizedAddress;
        address grantedBy;
        uint256 grantedAt;
        uint256 expiresAt;
        bool active;
        bool exists;
    }

    RoleManager public immutable roleManager;
    PatientRegistry public immutable patientRegistry;
    AuditLog public immutable auditLog;

    mapping(bytes32 => AccessGrant) private grants;

    bytes32 private constant ACCESS_GRANTED = keccak256("ACCESS_GRANTED");
    bytes32 private constant ACCESS_REVOKED = keccak256("ACCESS_REVOKED");
    bytes32 private constant ACCESS_EXPIRED = keccak256("ACCESS_EXPIRED");

    event AccessGranted(
        bytes32 indexed patientRef, address indexed authorizedAddress, address indexed grantedBy, uint256 expiresAt
    );
    event AccessRevoked(bytes32 indexed patientRef, address indexed authorizedAddress, address indexed revokedBy);
    event AccessExpired(bytes32 indexed patientRef, address indexed authorizedAddress, uint256 expiresAt);

    error Unauthorized();
    error ZeroAddress();
    error InvalidExpiry();
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

    function grantAccess(bytes32 patientRef, address authorizedAddress, uint256 expiresAt) external {
        if (authorizedAddress == address(0)) revert ZeroAddress();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert InvalidExpiry();
        _requireActivePatient(patientRef);
        _requireController(patientRef);

        grants[_key(patientRef, authorizedAddress)] = AccessGrant({
            patientRef: patientRef,
            authorizedAddress: authorizedAddress,
            grantedBy: msg.sender,
            grantedAt: block.timestamp,
            expiresAt: expiresAt,
            active: true,
            exists: true
        });
        emit AccessGranted(patientRef, authorizedAddress, msg.sender, expiresAt);
        auditLog.recordAudit(msg.sender, patientRef, ACCESS_GRANTED, true);
    }

    function revokeAccess(bytes32 patientRef, address authorizedAddress) external {
        _requireController(patientRef);
        AccessGrant storage grant = grants[_key(patientRef, authorizedAddress)];
        if (!grant.exists || !grant.active) revert NoActiveGrant();
        grant.active = false;
        emit AccessRevoked(patientRef, authorizedAddress, msg.sender);
        auditLog.recordAudit(msg.sender, patientRef, ACCESS_REVOKED, true);
    }

    function expireAccess(bytes32 patientRef, address authorizedAddress) external {
        AccessGrant storage grant = grants[_key(patientRef, authorizedAddress)];
        if (!grant.exists || !grant.active) revert NoActiveGrant();
        if (grant.expiresAt == 0 || block.timestamp < grant.expiresAt) revert NotExpired();
        grant.active = false;
        emit AccessExpired(patientRef, authorizedAddress, grant.expiresAt);
        auditLog.recordAudit(msg.sender, patientRef, ACCESS_EXPIRED, true);
    }

    function hasAccess(bytes32 patientRef, address account) public view returns (bool) {
        if (!patientRegistry.isActivePatient(patientRef)) return false;
        AccessGrant storage grant = grants[_key(patientRef, account)];
        if (!grant.exists || !grant.active) return false;
        if (grant.expiresAt != 0 && block.timestamp >= grant.expiresAt) return false;
        return true;
    }

    function getAccessExpiry(bytes32 patientRef, address account) external view returns (uint256) {
        AccessGrant storage grant = grants[_key(patientRef, account)];
        if (!grant.exists) revert NoActiveGrant();
        return grant.expiresAt;
    }

    function _requireActivePatient(bytes32 patientRef) internal view {
        if (!patientRegistry.isActivePatient(patientRef)) revert PatientInactive();
    }

    function _requireController(bytes32 patientRef) internal view {
        address controller = patientRegistry.getController(patientRef);
        if (controller == address(0) || msg.sender != controller) revert Unauthorized();
    }

    function _key(bytes32 patientRef, address account) internal pure returns (bytes32) {
        return keccak256(abi.encode(patientRef, account));
    }
}
