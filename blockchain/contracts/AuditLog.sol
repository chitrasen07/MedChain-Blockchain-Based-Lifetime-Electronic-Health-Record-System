// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RoleManager} from "./RoleManager.sol";

/// @title AuditLog
/// @notice Append-only on-chain audit trail. Entries cannot be updated or deleted.
contract AuditLog {
    struct AuditEntry {
        address actor;
        string patientId;
        string action;
        string resourceId;
        uint256 timestamp;
        bool success;
    }

    RoleManager public immutable roleManager;
    mapping(address => bool) public authorizedLoggers;
    AuditEntry[] private entries;

    event AuditRecorded(
        uint256 indexed entryId,
        address indexed actor,
        string patientId,
        string action,
        string resourceId,
        uint256 timestamp,
        bool success
    );
    event LoggerAuthorized(address indexed logger, bool authorized, address indexed caller);

    error Unauthorized();
    error ZeroAddress();
    error InvalidEntry();

    constructor(address roleManager_) {
        if (roleManager_ == address(0)) revert ZeroAddress();
        roleManager = RoleManager(roleManager_);
        authorizedLoggers[msg.sender] = true;
    }

    modifier onlySuperAdmin() {
        if (!roleManager.hasRole(roleManager.SUPER_ADMIN_ROLE(), msg.sender)) revert Unauthorized();
        _;
    }

    function setAuthorizedLogger(address logger, bool authorized) external onlySuperAdmin {
        if (logger == address(0)) revert ZeroAddress();
        authorizedLoggers[logger] = authorized;
        emit LoggerAuthorized(logger, authorized, msg.sender);
    }

    function recordAudit(
        address actor,
        string calldata patientId,
        string calldata action,
        string calldata resourceId,
        bool success
    ) external returns (uint256 entryId) {
        if (!authorizedLoggers[msg.sender]) revert Unauthorized();
        if (bytes(action).length == 0) revert InvalidEntry();

        entryId = entries.length;
        entries.push(
            AuditEntry({
                actor: actor,
                patientId: patientId,
                action: action,
                resourceId: resourceId,
                timestamp: block.timestamp,
                success: success
            })
        );

        emit AuditRecorded(entryId, actor, patientId, action, resourceId, block.timestamp, success);
    }

    function totalEntries() external view returns (uint256) {
        return entries.length;
    }

    function getEntry(uint256 entryId)
        external
        view
        returns (
            address actor,
            string memory patientId,
            string memory action,
            string memory resourceId,
            uint256 timestamp,
            bool success
        )
    {
        if (entryId >= entries.length) revert InvalidEntry();
        AuditEntry storage entry = entries[entryId];
        return (entry.actor, entry.patientId, entry.action, entry.resourceId, entry.timestamp, entry.success);
    }
}
