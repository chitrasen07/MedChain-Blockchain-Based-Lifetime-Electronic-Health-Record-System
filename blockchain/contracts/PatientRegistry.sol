// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RoleManager} from "./RoleManager.sol";
import {AuditLog} from "./AuditLog.sol";

/// @title PatientRegistry
/// @notice Registers opaque patient references and individual controllers.
/// @dev Stored values and events are public. Friendly patient IDs stay off-chain.
/// A patient without a wallet is registered unclaimed. The hospital cannot choose
/// that patient's controller later.
contract PatientRegistry {
    uint256 public constant CLAIM_DELAY = 1 hours;
    uint256 public constant CLAIM_WINDOW = 24 hours;

    bytes32 public constant CLAIM_DOMAIN = keccak256("MedChain.claim.v1");
    bytes32 public constant RECOVERY_DOMAIN = keccak256("MedChain.recovery.v1");
    bytes32 private constant PATIENT_REGISTERED = keccak256("PATIENT_REGISTERED");
    bytes32 private constant PATIENT_DEACTIVATED = keccak256("PATIENT_DEACTIVATED");
    bytes32 private constant CONTROLLER_CLAIMED = keccak256("CONTROLLER_CLAIMED");
    bytes32 private constant CONTROLLER_TRANSFERRED = keccak256("CONTROLLER_TRANSFERRED");
    bytes32 private constant CONTROLLER_RECOVERED = keccak256("CONTROLLER_RECOVERED");

    struct Patient {
        address controller;
        address proposedController;
        address pendingClaimant;
        bytes32 identityCommitment;
        bytes32 claimCommitment;
        bytes32 pendingClaimHash;
        bytes32 recoveryCommitment;
        bytes32 pendingRecoveryHash;
        uint64 registeredAt;
        uint64 claimAnnouncedAt;
        uint64 recoveryAnnouncedAt;
        bool active;
        bool exists;
    }

    RoleManager public immutable roleManager;
    AuditLog public immutable auditLog;

    mapping(bytes32 => Patient) private patients;
    mapping(bytes32 => bytes32) private commitmentToPatient;

    event PatientRegistered(
        bytes32 indexed patientRef, bytes32 indexed identityCommitment, address controller, uint256 registeredAt
    );
    event ControllerClaimAnnounced(bytes32 indexed patientRef, address indexed claimant);
    event ControllerClaimed(bytes32 indexed patientRef, address indexed controller);
    event ControllerTransferProposed(bytes32 indexed patientRef, address indexed proposedController);
    event ControllerTransferred(bytes32 indexed patientRef, address indexed controller);
    event ControllerRecoveryAnnounced(bytes32 indexed patientRef, address indexed claimant);
    event ControllerRecovered(bytes32 indexed patientRef, address indexed controller);
    event PatientDeactivated(bytes32 indexed patientRef, address indexed deactivatedBy);

    error Unauthorized();
    error ZeroAddress();
    error InvalidIdentifier();
    error InvalidOwnership();
    error InvalidClaim();
    error PatientAlreadyExists();
    error PatientNotFound();
    error PatientInactive();
    error IdentityCommitmentAlreadyExists();
    error ControllerAlreadySet();
    error ControllerNotSet();
    error ClaimTooEarly();
    error ClaimPending();

    constructor(address roleManager_, address auditLog_) {
        if (roleManager_ == address(0) || auditLog_ == address(0)) revert ZeroAddress();
        roleManager = RoleManager(roleManager_);
        auditLog = AuditLog(auditLog_);
    }

    modifier onlyHospitalAdmin() {
        if (!roleManager.isHospitalAdmin(msg.sender)) revert Unauthorized();
        _;
    }

    /// @notice Registers a patient. Exactly one of controller or claimCommitment is set.
    /// @param patientRef Opaque reference generated off-chain. It is not a sequential ID.
    /// @param controller Patient wallet, or the zero address when the patient will claim later.
    /// @param identityCommitment HMAC or hash produced off-chain. Raw personal data is rejected by convention and must not be supplied.
    /// @param claimCommitment keccak256(abi.encode(secret, CLAIM_DOMAIN)) when the patient has no wallet yet.
    function registerPatient(
        bytes32 patientRef,
        address controller,
        bytes32 identityCommitment,
        bytes32 claimCommitment
    ) external onlyHospitalAdmin {
        if (patientRef == bytes32(0) || identityCommitment == bytes32(0)) revert InvalidIdentifier();
        if (patients[patientRef].exists) revert PatientAlreadyExists();
        if (commitmentToPatient[identityCommitment] != bytes32(0)) revert IdentityCommitmentAlreadyExists();

        bool hasController = controller != address(0);
        bool hasClaim = claimCommitment != bytes32(0);
        if (hasController == hasClaim) revert InvalidOwnership();

        patients[patientRef] = Patient({
            controller: controller,
            proposedController: address(0),
            pendingClaimant: address(0),
            identityCommitment: identityCommitment,
            claimCommitment: claimCommitment,
            pendingClaimHash: bytes32(0),
            recoveryCommitment: bytes32(0),
            pendingRecoveryHash: bytes32(0),
            registeredAt: uint64(block.timestamp),
            claimAnnouncedAt: 0,
            recoveryAnnouncedAt: 0,
            active: true,
            exists: true
        });
        commitmentToPatient[identityCommitment] = patientRef;

        emit PatientRegistered(patientRef, identityCommitment, controller, block.timestamp);
        auditLog.recordAudit(msg.sender, patientRef, PATIENT_REGISTERED, true);
    }

    function announceControllerClaim(bytes32 patientRef, bytes32 sealedClaim) external {
        Patient storage patient = _requireActive(patientRef);
        if (patient.controller != address(0)) revert ControllerAlreadySet();
        if (sealedClaim == bytes32(0)) revert InvalidIdentifier();
        _reserveAnnouncement(patient.pendingClaimant, patient.claimAnnouncedAt);
        patient.pendingClaimant = msg.sender;
        patient.pendingClaimHash = sealedClaim;
        patient.claimAnnouncedAt = uint64(block.timestamp);
        emit ControllerClaimAnnounced(patientRef, msg.sender);
    }

    function revealControllerClaim(bytes32 patientRef, bytes32 claimSecret) external {
        Patient storage patient = _requireActive(patientRef);
        if (patient.controller != address(0)) revert ControllerAlreadySet();
        if (patient.pendingClaimant != msg.sender) revert Unauthorized();
        if (block.timestamp < uint256(patient.claimAnnouncedAt) + CLAIM_DELAY) revert ClaimTooEarly();
        if (keccak256(abi.encode(claimSecret, CLAIM_DOMAIN)) != patient.claimCommitment) revert InvalidClaim();
        if (keccak256(abi.encode(msg.sender, claimSecret, patientRef, CLAIM_DOMAIN)) != patient.pendingClaimHash) {
            revert InvalidClaim();
        }

        patient.controller = msg.sender;
        patient.claimCommitment = bytes32(0);
        patient.pendingClaimHash = bytes32(0);
        patient.pendingClaimant = address(0);
        emit ControllerClaimed(patientRef, msg.sender);
        auditLog.recordAudit(msg.sender, patientRef, CONTROLLER_CLAIMED, true);
    }

    function proposeControllerTransfer(bytes32 patientRef, address newController) external {
        Patient storage patient = _requireControlled(patientRef);
        if (newController == address(0) || newController == patient.controller) revert ZeroAddress();
        patient.proposedController = newController;
        emit ControllerTransferProposed(patientRef, newController);
    }

    function acceptControllerTransfer(bytes32 patientRef) external {
        Patient storage patient = _requireActive(patientRef);
        if (patient.proposedController != msg.sender) revert Unauthorized();
        patient.controller = msg.sender;
        patient.proposedController = address(0);
        emit ControllerTransferred(patientRef, msg.sender);
        auditLog.recordAudit(msg.sender, patientRef, CONTROLLER_TRANSFERRED, true);
    }

    function cancelControllerTransfer(bytes32 patientRef) external {
        Patient storage patient = _requireControlled(patientRef);
        patient.proposedController = address(0);
    }

    function setRecoveryCommitment(bytes32 patientRef, bytes32 recoveryCommitment) external {
        Patient storage patient = _requireControlled(patientRef);
        patient.recoveryCommitment = recoveryCommitment;
        patient.pendingRecoveryHash = bytes32(0);
        patient.recoveryAnnouncedAt = 0;
    }

    function announceControllerRecovery(bytes32 patientRef, bytes32 sealedRecovery) external {
        Patient storage patient = _requireActive(patientRef);
        if (patient.recoveryCommitment == bytes32(0)) revert InvalidClaim();
        if (sealedRecovery == bytes32(0)) revert InvalidIdentifier();
        _reserveAnnouncement(patient.pendingClaimant, patient.recoveryAnnouncedAt);
        patient.pendingClaimant = msg.sender;
        patient.pendingRecoveryHash = sealedRecovery;
        patient.recoveryAnnouncedAt = uint64(block.timestamp);
        emit ControllerRecoveryAnnounced(patientRef, msg.sender);
    }

    function revealControllerRecovery(bytes32 patientRef, bytes32 recoverySecret) external {
        Patient storage patient = _requireActive(patientRef);
        if (patient.pendingClaimant != msg.sender) revert Unauthorized();
        if (patient.recoveryAnnouncedAt == 0 || block.timestamp < uint256(patient.recoveryAnnouncedAt) + CLAIM_DELAY) {
            revert ClaimTooEarly();
        }
        if (keccak256(abi.encode(recoverySecret, RECOVERY_DOMAIN)) != patient.recoveryCommitment) revert InvalidClaim();
        if (
            keccak256(abi.encode(msg.sender, recoverySecret, patientRef, RECOVERY_DOMAIN))
                != patient.pendingRecoveryHash
        ) revert InvalidClaim();

        patient.controller = msg.sender;
        patient.proposedController = address(0);
        patient.recoveryCommitment = bytes32(0);
        patient.pendingRecoveryHash = bytes32(0);
        patient.pendingClaimant = address(0);
        patient.claimCommitment = bytes32(0);
        emit ControllerRecovered(patientRef, msg.sender);
        auditLog.recordAudit(msg.sender, patientRef, CONTROLLER_RECOVERED, true);
    }

    function deactivatePatient(bytes32 patientRef) external onlyHospitalAdmin {
        Patient storage patient = _requireActive(patientRef);
        patient.active = false;
        emit PatientDeactivated(patientRef, msg.sender);
        auditLog.recordAudit(msg.sender, patientRef, PATIENT_DEACTIVATED, true);
    }

    function patientExists(bytes32 patientRef) external view returns (bool) {
        return patients[patientRef].exists;
    }

    function isActivePatient(bytes32 patientRef) external view returns (bool) {
        Patient storage patient = patients[patientRef];
        return patient.exists && patient.active;
    }

    function getController(bytes32 patientRef) external view returns (address) {
        Patient storage patient = _requirePatient(patientRef);
        return patient.controller;
    }

    function getPatient(bytes32 patientRef)
        external
        view
        returns (address controller, bool active, uint256 registeredAt)
    {
        Patient storage patient = _requirePatient(patientRef);
        return (patient.controller, patient.active, patient.registeredAt);
    }

    function identityCommitmentExists(bytes32 identityCommitment) external view returns (bool) {
        return commitmentToPatient[identityCommitment] != bytes32(0);
    }

    function patientForCommitment(bytes32 identityCommitment) external view returns (bytes32) {
        return commitmentToPatient[identityCommitment];
    }

    function _requirePatient(bytes32 patientRef) internal view returns (Patient storage patient) {
        patient = patients[patientRef];
        if (!patient.exists) revert PatientNotFound();
    }

    function _requireActive(bytes32 patientRef) internal view returns (Patient storage patient) {
        patient = _requirePatient(patientRef);
        if (!patient.active) revert PatientInactive();
    }

    function _requireControlled(bytes32 patientRef) internal view returns (Patient storage patient) {
        patient = _requireActive(patientRef);
        if (patient.controller == address(0) || msg.sender != patient.controller) revert Unauthorized();
    }

    function _reserveAnnouncement(address claimant, uint64 announcedAt) internal view {
        if (announcedAt == 0) return;
        if (block.timestamp < uint256(announcedAt) + CLAIM_DELAY + CLAIM_WINDOW && msg.sender != claimant) {
            revert ClaimPending();
        }
    }
}
