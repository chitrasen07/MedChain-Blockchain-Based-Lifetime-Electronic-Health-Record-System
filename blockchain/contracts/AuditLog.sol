// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RoleManager} from "./RoleManager.sol";

/// @title AuditLog
/// @notice Append-only commitments for on-chain actions. Detailed audit text stays off-chain.
/// @dev Every stored field is public to anyone who reads the chain. This contract does not
/// provide confidentiality.
contract AuditLog {
    struct AuditEntry {
        address actor;
        bytes32 subject;
        bytes32 actionCode;
        uint256 timestamp;
        bool success;
    }

    RoleManager public immutable roleManager;
    mapping(address => bool) public authorizedLoggers;
    AuditEntry[] private entries;

    event AuditRecorded(
        uint256 indexed entryId,
        address indexed actor,
        bytes32 indexed subject,
        bytes32 actionCode,
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

    function recordAudit(address actor, bytes32 subject, bytes32 actionCode, bool success)
        external
        returns (uint256 entryId)
    {
        if (!authorizedLoggers[msg.sender]) revert Unauthorized();
        if (actionCode == bytes32(0)) revert InvalidEntry();

        entryId = entries.length;
        entries.push(
            AuditEntry({
                actor: actor,
                subject: subject,
                actionCode: actionCode,
                timestamp: block.timestamp,
                success: success
            })
        );
        emit AuditRecorded(entryId, actor, subject, actionCode, block.timestamp, success);
    }

    function totalEntries() external view returns (uint256) {
        return entries.length;
    }

    function getEntry(uint256 entryId)
        external
        view
        returns (address actor, bytes32 subject, bytes32 actionCode, uint256 timestamp, bool success)
    {
        if (entryId >= entries.length) revert InvalidEntry();
        AuditEntry storage entry = entries[entryId];
        return (entry.actor, entry.subject, entry.actionCode, entry.timestamp, entry.success);
    }
}
