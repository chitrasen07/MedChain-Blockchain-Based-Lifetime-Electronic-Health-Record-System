// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RoleManager} from "./RoleManager.sol";
import {PatientRegistry} from "./PatientRegistry.sol";
import {AuditLog} from "./AuditLog.sol";

/// @title RecordAccessControl
/// @notice Patient-controlled permanent or time-limited record access grants.
/// @dev Named RecordAccessControl to avoid colliding with OpenZeppelin AccessControl.
contract RecordAccessControl {
    struct AccessGrant {
        string patientId;
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

    event AccessGranted(
        string patientId,
        address indexed authorizedAddress,
        address indexed grantedBy,
        uint256 grantedAt,
        uint256 expiresAt
    );
    event AccessRevoked(string patientId, address indexed authorizedAddress, address indexed revokedBy);
    event AccessExpired(string patientId, address indexed authorizedAddress, uint256 expiresAt);

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

    function grantAccess(string calldata patientId, address authorizedAddress, uint256 expiresAt)
        external
    {
        if (authorizedAddress == address(0)) revert ZeroAddress();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert InvalidExpiry();
        _requireActivePatient(patientId);
        _requireGrantAuthority(patientId);

        bytes32 key = _key(patientId, authorizedAddress);
        grants[key] = AccessGrant({
            patientId: patientId,
            authorizedAddress: authorizedAddress,
            grantedBy: msg.sender,
            grantedAt: block.timestamp,
            expiresAt: expiresAt,
            active: true,
            exists: true
        });

        emit AccessGranted(patientId, authorizedAddress, msg.sender, block.timestamp, expiresAt);
        auditLog.recordAudit(msg.sender, patientId, "ACCESS_GRANTED", _toHex(authorizedAddress), true);
    }

    function revokeAccess(string calldata patientId, address authorizedAddress) external {
        _requireGrantAuthority(patientId);
        AccessGrant storage grant = grants[_key(patientId, authorizedAddress)];
        if (!grant.exists || !grant.active) revert NoActiveGrant();

        grant.active = false;
        emit AccessRevoked(patientId, authorizedAddress, msg.sender);
        auditLog.recordAudit(msg.sender, patientId, "ACCESS_REVOKED", _toHex(authorizedAddress), true);
    }

    function expireAccess(string calldata patientId, address authorizedAddress) external {
        AccessGrant storage grant = grants[_key(patientId, authorizedAddress)];
        if (!grant.exists || !grant.active) revert NoActiveGrant();
        if (grant.expiresAt == 0 || block.timestamp < grant.expiresAt) revert NotExpired();

        grant.active = false;
        emit AccessExpired(patientId, authorizedAddress, grant.expiresAt);
    }

    function hasAccess(string calldata patientId, address account) public view returns (bool) {
        if (!patientRegistry.isActivePatient(patientId)) return false;
        AccessGrant storage grant = grants[_key(patientId, account)];
        if (!grant.exists || !grant.active) return false;
        if (grant.expiresAt != 0 && block.timestamp >= grant.expiresAt) return false;
        return true;
    }

    function getAccessExpiry(string calldata patientId, address account) external view returns (uint256) {
        AccessGrant storage grant = grants[_key(patientId, account)];
        if (!grant.exists) revert NoActiveGrant();
        return grant.expiresAt;
    }

    function getAccess(string calldata patientId, address account)
        external
        view
        returns (
            address authorizedAddress,
            address grantedBy,
            uint256 grantedAt,
            uint256 expiresAt,
            bool active
        )
    {
        AccessGrant storage grant = grants[_key(patientId, account)];
        if (!grant.exists) revert NoActiveGrant();
        bool currentlyActive = grant.active
            && (grant.expiresAt == 0 || block.timestamp < grant.expiresAt)
            && patientRegistry.isActivePatient(patientId);
        return (grant.authorizedAddress, grant.grantedBy, grant.grantedAt, grant.expiresAt, currentlyActive);
    }

    function _requireActivePatient(string calldata patientId) internal view {
        if (!patientRegistry.isActivePatient(patientId)) revert PatientInactive();
    }

    function _requireGrantAuthority(string calldata patientId) internal view {
        address controller = patientRegistry.getController(patientId);
        if (msg.sender == controller || roleManager.isHospitalAdmin(msg.sender)) {
            return;
        }
        revert Unauthorized();
    }

    function _key(string calldata patientId, address account) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(patientId, account));
    }

    function _toHex(address account) internal pure returns (string memory) {
        bytes16 hexSymbols = "0123456789abcdef";
        bytes20 data = bytes20(account);
        bytes memory str = new bytes(42);
        str[0] = "0";
        str[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            uint8 b = uint8(data[i]);
            str[2 + i * 2] = hexSymbols[b >> 4];
            str[3 + i * 2] = hexSymbols[b & 0x0f];
        }
        return string(str);
    }
}
