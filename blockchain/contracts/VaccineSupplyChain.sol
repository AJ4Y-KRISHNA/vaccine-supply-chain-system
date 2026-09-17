// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract VaccineSupplyChain {
    address public immutable owner;
    address public immutable productionSigner;
    address public immutable labSigner;
    mapping(address => bool) public writers;
    mapping(bytes32 => bytes32) public auditDigests;
    event WriterUpdated(address indexed writer, bool enabled);
    event AuditAnchored(bytes32 indexed eventId, bytes32 digest, address indexed writer);

    constructor(address production, address lab) {
        require(production != address(0) && lab != address(0) && production != lab, "Distinct release signers required");
        owner = msg.sender;
        productionSigner = production;
        labSigner = lab;
        writers[msg.sender] = true;
    }
    modifier onlyWriter() { require(writers[msg.sender], "Writer required"); _; }
    function setWriter(address writer, bool enabled) external {
        require(msg.sender == owner, "Owner required");
        require(writer != address(0), "Zero writer");
        writers[writer] = enabled;
        emit WriterUpdated(writer, enabled);
    }
    function anchorAudit(bytes32 eventId, bytes32 digest) external onlyWriter {
        require(eventId != bytes32(0) && digest != bytes32(0), "Empty anchor");
        bytes32 existing = auditDigests[eventId];
        require(existing == bytes32(0) || existing == digest, "Audit digest conflict");
        if (existing == bytes32(0)) {
            auditDigests[eventId] = digest;
            emit AuditAnchored(eventId, digest, msg.sender);
        }
    }
    struct Distribution {
        string targetCenter;
        uint256 recommendedUnits;
        string priorityScore;
        uint256 timestamp;
    }

    struct Batch {
        string batchId;
        string vaccineType;
        uint256 quantity;
        address manufacturer;
        string status;
        bool productionApproved;
        bool labApproved;
        bool releaseVisible;
        uint256 baselineDemandForecast;
    }

    struct InventoryCertificate {
        string batchId;
        string vaccineType;
        uint256 predictedDemand;
        string certificateUri;
        uint256 issuedAt;
        address issuer;
    }

    struct LifecycleEvent {
        string batchId;
        string actorRole;
        string action;
        string location;
        string details;
        uint256 quantity;
        uint256 timestamp;
        address actor;
    }

    Distribution[] public distributions;
    mapping(string => Batch) public batches;
    mapping(string => InventoryCertificate) private inventoryCertificates;
    mapping(string => LifecycleEvent[]) private batchLifecycle;

    event DistributionRecorded(
        string indexed targetCenter,
        uint256 recommendedUnits,
        string priorityScore,
        uint256 timestamp,
        address indexed actor
    );

    event BatchRegistered(
        string indexed batchId,
        string vaccineType,
        uint256 quantity,
        address indexed manufacturer,
        uint256 timestamp
    );

    event LifecycleLogged(
        string indexed batchId,
        string actorRole,
        string action,
        string location,
        string details,
        uint256 quantity,
        uint256 timestamp,
        address indexed actor
    );

    event BatchStatusUpdated(
        string indexed batchId,
        string status,
        uint256 timestamp,
        address indexed actor
    );

    event InventoryCertificateMinted(
        string indexed batchId,
        string vaccineType,
        uint256 predictedDemand,
        string certificateUri,
        uint256 timestamp,
        address indexed actor
    );

    event BatchReleaseRoleSigned(
        string indexed batchId,
        string role,
        uint256 timestamp,
        address indexed actor
    );

    event BatchReleasedToSupplyChain(
        string indexed batchId,
        uint256 timestamp,
        address indexed actor
    );

    function recordDistribution(
        string memory _targetCenter,
        uint256 _recommendedUnits,
        string memory _priorityScore
    ) public onlyWriter {
        distributions.push(
            Distribution({
                targetCenter: _targetCenter,
                recommendedUnits: _recommendedUnits,
                priorityScore: _priorityScore,
                timestamp: block.timestamp
            })
        );

        emit DistributionRecorded(
            _targetCenter,
            _recommendedUnits,
            _priorityScore,
            block.timestamp,
            msg.sender
        );
    }

    function recordDistributionWithBatch(
        string memory _batchId,
        string memory _targetCenter,
        uint256 _recommendedUnits,
        string memory _priorityScore,
        string memory _details
    ) public onlyWriter {
        recordDistribution(_targetCenter, _recommendedUnits, _priorityScore);
        _logLifecycleEvent(
            _batchId,
            "Distributor",
            "Distribution Recorded",
            _targetCenter,
            _details,
            _recommendedUnits
        );
    }

    function registerBatch(
        string memory _batchId,
        string memory _vaccineType,
        uint _quantity
    ) public onlyWriter {
        require(bytes(_batchId).length > 0, "Batch ID required");
        require(bytes(batches[_batchId].batchId).length == 0, "Batch already registered");
        batches[_batchId] = Batch(
            _batchId,
            _vaccineType,
            _quantity,
            msg.sender,
            "Awaiting Multi-Sign Release",
            false,
            false,
            false,
            0
        );

        emit BatchRegistered(
            _batchId,
            _vaccineType,
            _quantity,
            msg.sender,
            block.timestamp
        );

        _logLifecycleEvent(
            _batchId,
            "Manufacturer",
            "Batch Registered",
            "Manufacturer Warehouse",
            _vaccineType,
            _quantity
        );
    }

    function mintInventoryCertificate(
        string memory _batchId,
        string memory _vaccineType,
        uint256 _predictedDemand,
        string memory _certificateUri
    ) public onlyWriter {
        require(bytes(_batchId).length > 0, "Batch ID required");
        require(bytes(batches[_batchId].batchId).length > 0, "Batch not found");

        inventoryCertificates[_batchId] = InventoryCertificate({
            batchId: _batchId,
            vaccineType: _vaccineType,
            predictedDemand: _predictedDemand,
            certificateUri: _certificateUri,
            issuedAt: block.timestamp,
            issuer: msg.sender
        });

        if (bytes(batches[_batchId].batchId).length > 0) {
            batches[_batchId].baselineDemandForecast = _predictedDemand;
        }

        emit InventoryCertificateMinted(
            _batchId,
            _vaccineType,
            _predictedDemand,
            _certificateUri,
            block.timestamp,
            msg.sender
        );

        _logLifecycleEvent(
            _batchId,
            "Manufacturer",
            "Mint Inventory Certificate",
            "Manufacturer Planning",
            _certificateUri,
            _predictedDemand
        );
    }

    function approveBatchRelease(
        string memory _batchId,
        string memory _role
    ) public {
        require(bytes(_batchId).length > 0, "Batch ID required");
        require(bytes(batches[_batchId].batchId).length > 0, "Batch not found");

        bytes32 roleHash = keccak256(bytes(_role));

        if (roleHash == keccak256(bytes("Production"))) {
            require(msg.sender == productionSigner, "Production signer required");
            batches[_batchId].productionApproved = true;
        } else if (roleHash == keccak256(bytes("Lab Testing"))) {
            require(msg.sender == labSigner, "Lab signer required");
            batches[_batchId].labApproved = true;
        } else {
            revert("Invalid release role");
        }

        emit BatchReleaseRoleSigned(_batchId, _role, block.timestamp, msg.sender);

        _logLifecycleEvent(
            _batchId,
            "Manufacturer",
            "Release Sign-Off",
            "Quality Gate",
            _role,
            batches[_batchId].quantity
        );

        if (
            batches[_batchId].productionApproved &&
            batches[_batchId].labApproved
        ) {
            batches[_batchId].releaseVisible = true;
            batches[_batchId].status = "Released to Supply Chain";

            emit BatchReleasedToSupplyChain(_batchId, block.timestamp, msg.sender);

            _logLifecycleEvent(
                _batchId,
                "Manufacturer",
                "Release Batch To Supply Chain",
                "Manufacturer Warehouse",
                "Production and Lab Testing approvals completed",
                batches[_batchId].quantity
            );
        }
    }

    function updateBatchStatus(
        string memory _batchId,
        string memory _status
    ) public onlyWriter {
        require(bytes(_batchId).length > 0, "Batch ID required");
        require(bytes(batches[_batchId].batchId).length > 0, "Batch not found");

        if (bytes(batches[_batchId].batchId).length > 0) {
            batches[_batchId].status = _status;
        }

        emit BatchStatusUpdated(_batchId, _status, block.timestamp, msg.sender);
    }

    function logLifecycleEvent(
        string memory _batchId,
        string memory _actorRole,
        string memory _action,
        string memory _location,
        string memory _details,
        uint256 _quantity
    ) public onlyWriter {
        _logLifecycleEvent(
            _batchId,
            _actorRole,
            _action,
            _location,
            _details,
            _quantity
        );
    }

    function getLifecycleCount(
        string memory _batchId
    ) public view returns (uint256) {
        return batchLifecycle[_batchId].length;
    }

    function getLifecycleEvent(
        string memory _batchId,
        uint256 _index
    )
        public
        view
        returns (
            string memory,
            string memory,
            string memory,
            string memory,
            string memory,
            uint256,
            uint256,
            address
        )
    {
        LifecycleEvent memory lifecycle = batchLifecycle[_batchId][_index];

        return (
            lifecycle.batchId,
            lifecycle.actorRole,
            lifecycle.action,
            lifecycle.location,
            lifecycle.details,
            lifecycle.quantity,
            lifecycle.timestamp,
            lifecycle.actor
        );
    }

    function getBatch(string memory _batchId)
        public
        view
        returns (
            string memory,
            string memory,
            uint,
            address,
            string memory
        )
    {
        Batch memory b = batches[_batchId];

        return (
            b.batchId,
            b.vaccineType,
            b.quantity,
            b.manufacturer,
            b.status
        );
    }

    function getInventoryCertificate(
        string memory _batchId
    )
        public
        view
        returns (
            string memory,
            string memory,
            uint256,
            string memory,
            uint256,
            address
        )
    {
        InventoryCertificate memory cert = inventoryCertificates[_batchId];
        return (
            cert.batchId,
            cert.vaccineType,
            cert.predictedDemand,
            cert.certificateUri,
            cert.issuedAt,
            cert.issuer
        );
    }

    function getReleaseState(
        string memory _batchId
    )
        public
        view
        returns (
            bool,
            bool,
            bool,
            string memory
        )
    {
        Batch memory batch = batches[_batchId];
        return (
            batch.productionApproved,
            batch.labApproved,
            batch.releaseVisible,
            batch.status
        );
    }

    function _logLifecycleEvent(
        string memory _batchId,
        string memory _actorRole,
        string memory _action,
        string memory _location,
        string memory _details,
        uint256 _quantity
    ) internal {
        LifecycleEvent memory lifecycle = LifecycleEvent({
            batchId: _batchId,
            actorRole: _actorRole,
            action: _action,
            location: _location,
            details: _details,
            quantity: _quantity,
            timestamp: block.timestamp,
            actor: msg.sender
        });

        batchLifecycle[_batchId].push(lifecycle);

        emit LifecycleLogged(
            _batchId,
            _actorRole,
            _action,
            _location,
            _details,
            _quantity,
            block.timestamp,
            msg.sender
        );
    }
}
