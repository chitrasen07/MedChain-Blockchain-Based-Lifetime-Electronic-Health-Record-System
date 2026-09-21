// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title RoleManager
/// @notice Hospital role registry built on OpenZeppelin AccessControl.
contract RoleManager is AccessControl {
    bytes32 public constant PATIENT_ROLE = keccak256("PATIENT");
    bytes32 public constant DOCTOR_ROLE = keccak256("DOCTOR");
    bytes32 public constant NURSE_ROLE = keccak256("NURSE");
    bytes32 public constant LAB_TECHNICIAN_ROLE = keccak256("LAB_TECHNICIAN");
    bytes32 public constant PHARMACIST_ROLE = keccak256("PHARMACIST");
    bytes32 public constant SPECIALIST_ROLE = keccak256("SPECIALIST");
    bytes32 public constant HOSPITAL_ADMIN_ROLE = keccak256("HOSPITAL_ADMIN");
    bytes32 public constant AUDITOR_ROLE = keccak256("AUDITOR");
    bytes32 public constant SUPER_ADMIN_ROLE = keccak256("SUPER_ADMIN");

    event RoleAssigned(bytes32 indexed role, address indexed account, address indexed assignedBy);

    error Unauthorized();
    error ZeroAddress();

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(SUPER_ADMIN_ROLE, msg.sender);

        _setRoleAdmin(SUPER_ADMIN_ROLE, SUPER_ADMIN_ROLE);
        _setRoleAdmin(DEFAULT_ADMIN_ROLE, SUPER_ADMIN_ROLE);
        _setRoleAdmin(HOSPITAL_ADMIN_ROLE, SUPER_ADMIN_ROLE);
        _setRoleAdmin(AUDITOR_ROLE, SUPER_ADMIN_ROLE);
        _setRoleAdmin(PATIENT_ROLE, HOSPITAL_ADMIN_ROLE);
        _setRoleAdmin(DOCTOR_ROLE, HOSPITAL_ADMIN_ROLE);
        _setRoleAdmin(NURSE_ROLE, HOSPITAL_ADMIN_ROLE);
        _setRoleAdmin(LAB_TECHNICIAN_ROLE, HOSPITAL_ADMIN_ROLE);
        _setRoleAdmin(PHARMACIST_ROLE, HOSPITAL_ADMIN_ROLE);
        _setRoleAdmin(SPECIALIST_ROLE, HOSPITAL_ADMIN_ROLE);
    }

    function assignRole(bytes32 role, address account) external {
        if (account == address(0)) revert ZeroAddress();
        if (!_canManageRole(role, msg.sender)) revert Unauthorized();
        _grantRole(role, account);
        emit RoleAssigned(role, account, msg.sender);
    }

    function revokeRole(bytes32 role, address account) public override {
        if (account == address(0)) revert ZeroAddress();
        if (!_canManageRole(role, msg.sender)) revert Unauthorized();
        _revokeRole(role, account);
        emit RoleRevoked(role, account, msg.sender);
    }

    function isHospitalAdmin(address account) public view returns (bool) {
        return hasRole(SUPER_ADMIN_ROLE, account) || hasRole(HOSPITAL_ADMIN_ROLE, account);
    }

    function isMedicalStaff(address account) public view returns (bool) {
        return hasRole(DOCTOR_ROLE, account) || hasRole(NURSE_ROLE, account)
            || hasRole(LAB_TECHNICIAN_ROLE, account) || hasRole(PHARMACIST_ROLE, account)
            || hasRole(SPECIALIST_ROLE, account);
    }

    function isEmergencyResponder(address account) public view returns (bool) {
        return hasRole(DOCTOR_ROLE, account) || hasRole(SPECIALIST_ROLE, account)
            || hasRole(NURSE_ROLE, account);
    }

    function _canManageRole(bytes32 role, address account) internal view returns (bool) {
        if (hasRole(SUPER_ADMIN_ROLE, account)) {
            return true;
        }
        if (!hasRole(HOSPITAL_ADMIN_ROLE, account)) {
            return false;
        }
        return role == PATIENT_ROLE || role == DOCTOR_ROLE || role == NURSE_ROLE
            || role == LAB_TECHNICIAN_ROLE || role == PHARMACIST_ROLE || role == SPECIALIST_ROLE;
    }
}
