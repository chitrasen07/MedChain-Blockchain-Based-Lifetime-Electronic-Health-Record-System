// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RoleManager} from "./RoleManager.sol";
import {AuditLog} from "./AuditLog.sol";

/// @title PatientRegistry
/// @notice Generates sequential patient IDs and stores patient references.
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

    // The first registered patient receives PATIENT-000001.
    uint256 public nextPatientNumber = 1;

    mapping(bytes32 => Patient) private patients;
    mapping(bytes32 => bool) private usedDids;
    mapping(bytes32 => bool) private usedIdentityCommitments;

    event PatientRegistered(
        string patientId,
        string did,
        address indexed controller,
        uint256 registeredAt
    );

    event PatientDeactivated(
        string patientId,
        address indexed deactivatedBy,
        uint256 timestamp
    );

    error Unauthorized();
    error ZeroAddress();
    error InvalidIdentifier();
    error PatientAlreadyExists();
    error PatientNotFound();
    error PatientInactive();
    error DIDAlreadyExists();
    error IdentityCommitmentAlreadyExists();

    constructor(address roleManager_, address auditLog_) {
        if (roleManager_ == address(0) || auditLog_ == address(0)) {
            revert ZeroAddress();
        }

        roleManager = RoleManager(roleManager_);
        auditLog = AuditLog(auditLog_);
    }

    modifier onlyHospitalAdmin() {
        if (!roleManager.isHospitalAdmin(msg.sender)) {
            revert Unauthorized();
        }
        _;
    }

    /// @notice Registers a patient and generates their unique patient ID and DID.
    /// @param controller Wallet authorized to control patient access.
    /// @return patientId The newly generated ID, e.g. PATIENT-000001.
    function registerPatient(address controller)
        external
        onlyHospitalAdmin
        returns (string memory patientId)
    {
        return _registerPatient(controller);
    }

    /// @notice Registers a patient with an off-chain identity-service commitment.
    /// @dev The commitment must be generated from a high-entropy secret off chain.
    /// Raw government identifiers and personal data must never be supplied.
    function registerPatientWithIdentityCommitment(
        address controller,
        bytes32 identityCommitment
    )
        external
        onlyHospitalAdmin
        returns (string memory patientId)
    {
        if (identityCommitment == bytes32(0)) revert InvalidIdentifier();
        if (usedIdentityCommitments[identityCommitment]) {
            revert IdentityCommitmentAlreadyExists();
        }

        usedIdentityCommitments[identityCommitment] = true;
        return _registerPatient(controller);
    }

    function _registerPatient(
        address controller
    ) internal returns (string memory patientId) {
        if (controller == address(0)) revert ZeroAddress();

        uint256 registrationNumber = nextPatientNumber;
        patientId = _formatPatientId(nextPatientNumber);
        string memory did = _generateDid(registrationNumber);
        bytes32 didKey = keccak256(bytes(did));

        bytes32 patientKey = _key(patientId);
        if (patients[patientKey].exists) revert PatientAlreadyExists();
        if (usedDids[didKey]) revert DIDAlreadyExists();

        patients[patientKey] = Patient({
            patientId: patientId,
            did: did,
            controller: controller,
            active: true,
            registeredAt: block.timestamp,
            exists: true
        });

        usedDids[didKey] = true;
        nextPatientNumber++;

        emit PatientRegistered(
            patientId,
            did,
            controller,
            block.timestamp
        );

        auditLog.recordAudit(
            msg.sender,
            patientId,
            "PATIENT_REGISTERED",
            did,
            true
        );
    }

    function deactivatePatient(
        string calldata patientId
    ) external onlyHospitalAdmin {
        Patient storage patient = _requirePatient(patientId);
        if (!patient.active) revert PatientInactive();

        patient.active = false;

        emit PatientDeactivated(
            patientId,
            msg.sender,
            block.timestamp
        );

        auditLog.recordAudit(
            msg.sender,
            patientId,
            "PATIENT_DEACTIVATED",
            patient.did,
            true
        );
    }

    function patientExists(
        string calldata patientId
    ) external view returns (bool) {
        return patients[_key(patientId)].exists;
    }

    function getPatient(
        string calldata patientId
    )
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

        return (
            patient.patientId,
            patient.did,
            patient.controller,
            patient.active,
            patient.registeredAt
        );
    }

    function isActivePatient(
        string calldata patientId
    ) external view returns (bool) {
        Patient storage patient = patients[_key(patientId)];
        return patient.exists && patient.active;
    }

    function getController(
        string calldata patientId
    ) external view returns (address) {
        Patient storage patient = _requirePatient(patientId);
        return patient.controller;
    }

    function identityCommitmentExists(
        bytes32 identityCommitment
    ) external view returns (bool) {
        return usedIdentityCommitments[identityCommitment];
    }

    function _generateDid(
        uint256 registrationNumber
    ) internal view returns (string memory) {
        bytes32 uniqueIdentifier = keccak256(
            abi.encode(
                "MedChain.PatientRegistry.DID.v1",
                address(this),
                registrationNumber
            )
        );

        return string.concat("did:medchain:", _toHex(uniqueIdentifier));
    }

    function _requirePatient(
        string calldata patientId
    ) internal view returns (Patient storage patient) {
        patient = patients[_key(patientId)];

        if (!patient.exists) revert PatientNotFound();
    }

    function _key(
        string memory patientId
    ) internal pure returns (bytes32) {
        return keccak256(bytes(patientId));
    }

    /// @dev Formats IDs with at least six digits.
    /// IDs continue to work beyond PATIENT-999999.
    function _formatPatientId(
        uint256 number
    ) internal pure returns (string memory) {
        string memory digits = _toString(number);
        bytes memory prefix = bytes("PATIENT-");

        if (bytes(digits).length >= 6) {
            return string.concat("PATIENT-", digits);
        }

        uint256 zeroCount = 6 - bytes(digits).length;
        bytes memory result = new bytes(prefix.length + zeroCount + bytes(digits).length);

        uint256 i;

        for (; i < prefix.length; i++) {
            result[i] = prefix[i];
        }

        for (uint256 j = 0; j < zeroCount; j++) {
            result[i++] = bytes1("0");
        }

        bytes memory digitBytes = bytes(digits);

        for (uint256 j = 0; j < digitBytes.length; j++) {
            result[i++] = digitBytes[j];
        }

        return string(result);
    }

    function _toString(
        uint256 value
    ) internal pure returns (string memory) {
        if (value == 0) return "0";

        uint256 temp = value;
        uint256 length;

        while (temp != 0) {
            length++;
            temp /= 10;
        }

        bytes memory buffer = new bytes(length);

        while (value != 0) {
            length--;
            buffer[length] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }

        return string(buffer);
    }

    function _toHex(
        bytes32 value
    ) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory result = new bytes(66);
        result[0] = "0";
        result[1] = "x";

        for (uint256 i = 0; i < 32; i++) {
            result[2 + i * 2] = alphabet[uint8(value[i] >> 4)];
            result[3 + i * 2] = alphabet[uint8(value[i] & 0x0f)];
        }

        return string(result);
    }
}