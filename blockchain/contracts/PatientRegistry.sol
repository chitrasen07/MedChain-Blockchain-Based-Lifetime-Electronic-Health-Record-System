// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RoleManager} from "./RoleManager.sol";
import {AuditLog} from "./AuditLog.sol";

/// @title PatientRegistry
/// @notice Stores only patient identifiers, DID references, and controller wallets.
contract PatientRegistry {
    struct Patient {
        string patientId;
        string did;
        address controller;
        bool active;
        uint256 registeredAt;
        bool exists;
    }

    RoleManager public immutable roleManager;
    AuditLog public immutable auditLog;

    mapping(bytes32 => Patient) private patients;

    event PatientRegistered(
        string patientId, string did, address indexed controller, uint256 registeredAt
    );
    event PatientDeactivated(string patientId, address indexed deactivatedBy, uint256 timestamp);

    error Unauthorized();
    error ZeroAddress();
    error InvalidIdentifier();
    error PatientAlreadyExists();
    error PatientNotFound();
    error PatientInactive();

    constructor(address roleManager_, address auditLog_) {
        if (roleManager_ == address(0) || auditLog_ == address(0)) revert ZeroAddress();
        roleManager = RoleManager(roleManager_);
        auditLog = AuditLog(auditLog_);
    }

    modifier onlyHospitalAdmin() {
        if (!roleManager.isHospitalAdmin(msg.sender)) revert Unauthorized();
        _;
    }

    function registerPatient(string calldata patientId, string calldata did, address controller)
        external
        onlyHospitalAdmin
    {
        if (bytes(patientId).length == 0 || bytes(did).length == 0) revert InvalidIdentifier();
        if (controller == address(0)) revert ZeroAddress();

        bytes32 key = _key(patientId);
        if (patients[key].exists) revert PatientAlreadyExists();

        patients[key] = Patient({
            patientId: patientId,
            did: did,
            controller: controller,
            active: true,
            registeredAt: block.timestamp,
            exists: true
        });

        emit PatientRegistered(patientId, did, controller, block.timestamp);
        auditLog.recordAudit(msg.sender, patientId, "PATIENT_REGISTERED", did, true);
    }

    function deactivatePatient(string calldata patientId) external onlyHospitalAdmin {
        Patient storage patient = _requirePatient(patientId);
        if (!patient.active) revert PatientInactive();

        patient.active = false;
        emit PatientDeactivated(patientId, msg.sender, block.timestamp);
        auditLog.recordAudit(msg.sender, patientId, "PATIENT_DEACTIVATED", patient.did, true);
    }

    function patientExists(string calldata patientId) external view returns (bool) {
        return patients[_key(patientId)].exists;
    }

    function getPatient(string calldata patientId)
        external
        view
        returns (
            string memory id,
            string memory did,
            address controller,
            bool active,
            uint256 registeredAt
        )
    {
        Patient storage patient = _requirePatient(patientId);
        return (patient.patientId, patient.did, patient.controller, patient.active, patient.registeredAt);
    }

    function isActivePatient(string calldata patientId) external view returns (bool) {
        Patient storage patient = patients[_key(patientId)];
        return patient.exists && patient.active;
    }

    function getController(string calldata patientId) external view returns (address) {
        Patient storage patient = _requirePatient(patientId);
        return patient.controller;
    }

    function _requirePatient(string calldata patientId) internal view returns (Patient storage patient) {
        patient = patients[_key(patientId)];
        if (!patient.exists) revert PatientNotFound();
    }

    function _key(string calldata patientId) internal pure returns (bytes32) {
        return keccak256(bytes(patientId));
    }
}
