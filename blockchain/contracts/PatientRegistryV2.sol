// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {RoleManager} from "./RoleManager.sol";
import {AuditLog} from "./AuditLog.sol";

/// @title PatientRegistryV2
/// @notice Patient references with immediate wallet claiming. There is no claim delay.
/// @dev The claim secret is checked against the registration commitment and the wallet
/// signature binds that commitment to msg.sender, so a copied transaction cannot
/// assign ownership to a different account.
contract PatientRegistryV2 {
    bytes32 public constant CLAIM_DOMAIN = keccak256("MedChain.claim.v1");
    bytes32 public constant CLAIM_TYPEHASH = keccak256("ClaimController(bytes32 patientRef,bytes32 claimCommitment)");
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("MedChain Patient Registry");
    bytes32 private constant VERSION_HASH = keccak256("2");
    bytes32 private constant PATIENT_REGISTERED = keccak256("PATIENT_REGISTERED");
    bytes32 private constant PATIENT_DEACTIVATED = keccak256("PATIENT_DEACTIVATED");
    bytes32 private constant CONTROLLER_CLAIMED = keccak256("CONTROLLER_CLAIMED");
    bytes32 private constant CONTROLLER_TRANSFERRED = keccak256("CONTROLLER_TRANSFERRED");

    struct Patient {
        address controller;
        address proposedController;
        bytes32 identityCommitment;
        bytes32 claimCommitment;
        uint64 registeredAt;
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
    event ControllerClaimed(bytes32 indexed patientRef, address indexed controller);
    event ControllerTransferProposed(bytes32 indexed patientRef, address indexed proposedController);
    event ControllerTransferred(bytes32 indexed patientRef, address indexed controller);
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
    error StaffOwner();

    constructor(address roleManager_, address auditLog_) {
        if (roleManager_ == address(0) || auditLog_ == address(0)) revert ZeroAddress();
        roleManager = RoleManager(roleManager_);
        auditLog = AuditLog(auditLog_);
    }

    modifier onlyHospitalAdmin() {
        if (!roleManager.isHospitalAdmin(msg.sender)) revert Unauthorized();
        _;
    }

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
        if (hasController) _rejectStaff(controller);

        patients[patientRef] = Patient({
            controller: controller,
            proposedController: address(0),
            identityCommitment: identityCommitment,
            claimCommitment: claimCommitment,
            registeredAt: uint64(block.timestamp),
            active: true,
            exists: true
        });
        commitmentToPatient[identityCommitment] = patientRef;
        emit PatientRegistered(patientRef, identityCommitment, controller, block.timestamp);
        auditLog.recordAudit(msg.sender, patientRef, PATIENT_REGISTERED, true);
    }

    /// @notice Links the signing wallet immediately. The secret is not sufficient by itself.
    function claimController(bytes32 patientRef, bytes32 secret, bytes calldata signature) external {
        Patient storage patient = _requireActive(patientRef);
        if (patient.controller != address(0)) revert ControllerAlreadySet();
        bytes32 commitment = keccak256(abi.encode(secret, CLAIM_DOMAIN));
        if (commitment != patient.claimCommitment) revert InvalidClaim();
        _rejectStaff(msg.sender);
        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPEHASH, patientRef, commitment));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
        (address signer, ECDSA.RecoverError error, ) = ECDSA.tryRecover(digest, signature);
        if (error != ECDSA.RecoverError.NoError || signer != msg.sender) revert Unauthorized();

        patient.controller = msg.sender;
        patient.claimCommitment = bytes32(0);
        emit ControllerClaimed(patientRef, msg.sender);
        auditLog.recordAudit(msg.sender, patientRef, CONTROLLER_CLAIMED, true);
    }

    function proposeControllerTransfer(bytes32 patientRef, address newController) external {
        Patient storage patient = _requireControlled(patientRef);
        if (newController == address(0) || newController == patient.controller) revert ZeroAddress();
        _rejectStaff(newController);
        patient.proposedController = newController;
        emit ControllerTransferProposed(patientRef, newController);
    }

    function acceptControllerTransfer(bytes32 patientRef) external {
        Patient storage patient = _requireActive(patientRef);
        if (patient.proposedController != msg.sender) revert Unauthorized();
        _rejectStaff(msg.sender);
        patient.controller = msg.sender;
        patient.proposedController = address(0);
        emit ControllerTransferred(patientRef, msg.sender);
        auditLog.recordAudit(msg.sender, patientRef, CONTROLLER_TRANSFERRED, true);
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
        return _requirePatient(patientRef).controller;
    }

    function getPatient(bytes32 patientRef) external view returns (address controller, bool active, uint256 registeredAt) {
        Patient storage patient = _requirePatient(patientRef);
        return (patient.controller, patient.active, patient.registeredAt);
    }

    function identityCommitmentExists(bytes32 identityCommitment) external view returns (bool) {
        return commitmentToPatient[identityCommitment] != bytes32(0);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparator();
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function _rejectStaff(address account) internal view {
        if (roleManager.isHospitalAdmin(account) || roleManager.isMedicalStaff(account)) revert StaffOwner();
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
}
