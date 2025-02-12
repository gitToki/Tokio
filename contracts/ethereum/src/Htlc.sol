// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;
import {console} from "../lib/forge-std/src/Test.sol";

contract Htlc {
    struct Swap {
        address payable owner;
        bytes32 secretHash;
        uint256 amount;
        uint256 lockTime;
        bool claimed;
    }

    struct Transaction {
        address payable claimer;
        uint256 amount;
        bytes32 secretHash;
        string dehashedSecret;
    }

    uint256 public timeLock = 3600;

    mapping(bytes32 => Swap) public swaps;
    mapping(bytes32 => Transaction) public withdraw;

    event swapInitiated(
        bytes32 swapID,
        address indexed owner,
        uint256 amount,
        uint256 lockTime,
        bytes32 secretHash
    );
    event fundsWithdraw(
        bytes32 swapID,
        address indexed claimer,
        bytes32 indexed secretHash,
        string dehashedSecret
    );
    event timeWithdrawEvent(bytes32 swapID, address owner, uint256 amount);
    event withdrawFailed(bytes32 swapID, address claimer);

    function initiateSwap(bytes32 secret) public payable returns (bytes32) {
        require(msg.value > 0, "0 ETH deposited");

        bytes32 swapId = keccak256(
            abi.encodePacked(msg.sender, msg.value, block.timestamp)
        );

        swaps[swapId] = Swap({
            owner: payable(msg.sender),
            secretHash: secret,
            amount: msg.value,
            lockTime: block.timestamp + timeLock,
            claimed: false
        });

        emit swapInitiated(
            swapId,
            msg.sender,
            msg.value,
            block.timestamp + timeLock,
            secret
        );

        return swapId;
    }

    function withdrawFunds(
        string calldata dehashedSecret,
        bytes32 swapID
    ) public payable returns (bytes32) {
        Swap storage swap = swaps[swapID];
        require(
            keccak256(abi.encodePacked(dehashedSecret)) == swap.secretHash,
            "Wrong secret"
        );
        require(swap.amount > 0, "0 ETH on the HTLC contract");
        require(swap.claimed == false, "Funds already claimed");
        console.log("I'm here dawg");

        bytes32 withdrawId = keccak256(abi.encodePacked(swapID, msg.sender));

        swap.claimed = true;

        (bool success, ) = payable(msg.sender).call{value: swap.amount}("");

        if (!success) {
            swap.claimed = false;
            emit withdrawFailed(swapID, msg.sender);
            return keccak256("Withdraw Failled");
        }

        withdraw[withdrawId] = Transaction({
            claimer: payable(msg.sender),
            amount: swap.amount,
            secretHash: swap.secretHash,
            dehashedSecret: dehashedSecret
        });
        emit fundsWithdraw(swapID, msg.sender, swap.secretHash, dehashedSecret);

        return withdrawId;
    }

    function timeWithdraw(bytes32 swapIdNumber) public payable {
        Swap storage swap = swaps[swapIdNumber];
        require(
            block.timestamp >= swap.lockTime,
            "Please wait at least 1 hour since the initiation of the swap"
        );
        require(
            msg.sender == swap.owner,
            "Only the owner can withdraw the funds"
        );
        require(swap.claimed == false, "Funds already claimed");
        swap.claimed = true;
        payable(msg.sender).transfer(swap.amount);

        emit timeWithdrawEvent(swapIdNumber, msg.sender, swap.amount);
    }
}
