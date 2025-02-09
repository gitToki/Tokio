// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

contract Htlc {


    struct Swap {
        address payable sender;
        address payable claimer;
        bytes32 secretHash;
        uint256 amount;
        uint256 lockTime;
    }

    uint256 public timeLock = 3600;

    mapping (bytes32 => Swap) public swaps;



    function initiateSwap(bytes32 secret, address payable claimer) public payable {
        require(msg.value > 0, "0 ETH deposited");

        bytes32 swapId = keccak256(abi.encodePacked(msg.sender, claimer, msg.value, block.timestamp));

        swaps[swapId] = Swap({
            sender: payable(msg.sender),
            claimer: payable(claimer),
            secretHash: secret,
            amount: msg.value,
            lockTime: block.timestamp + timeLock
        });

        emit swapInitiated(swapId, msg.sender, claimer, msg.value, block.timestamp + timeLock, secret);

    }




    event swapInitiated(bytes32 swapID, address indexed owner, address indexed claimer, uint256 amount, uint256 lockTime, bytes32 secretHash);
}
